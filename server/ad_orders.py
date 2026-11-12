"""Private advertising ledger. Recording a contract never changes live ads."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import json
import re
import secrets

SCHEMA = """
CREATE TABLE IF NOT EXISTS ad_orders (
 id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE,
 ad_id INTEGER REFERENCES ads(id), advertiser TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL, slot TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), cancelled INTEGER NOT NULL DEFAULT 0,
 notes TEXT NOT NULL DEFAULT '', renewal_of INTEGER REFERENCES ad_orders(id),
 version INTEGER NOT NULL DEFAULT 1, request_key TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_order_payments (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES ad_orders(id),
 kind TEXT NOT NULL CHECK(kind IN ('receipt','refund')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_on TEXT NOT NULL, method TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_orders_ad ON ad_orders(ad_id,id);
CREATE INDEX IF NOT EXISTS ad_orders_parent ON ad_orders(renewal_of);
CREATE INDEX IF NOT EXISTS ad_payments_order ON ad_order_payments(order_id,id);
CREATE TABLE IF NOT EXISTS ad_order_deliveries (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES ad_orders(id),
 request_key TEXT NOT NULL UNIQUE, preview_token TEXT NOT NULL,
 before_schedule TEXT NOT NULL, after_schedule TEXT NOT NULL, applied_at TEXT NOT NULL
);
"""


def text(value, label, limit, required=False):
    value = str(value or '').strip()
    if (required and not value) or len(value) > limit:
        raise ValueError(f'{label}不能为空且最多 {limit} 个字' if required else f'{label}最多 {limit} 个字')
    return value


def money(value, positive=False):
    if isinstance(value, bool) or value is None:
        raise ValueError('请填写有效金额')
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > Decimal('99999999.99') or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError('金额须为非负数，最多两位小数且不超过 99999999.99 元')
    except (InvalidOperation, TypeError):
        raise ValueError('请填写有效金额')
    cents = int(amount * 100)
    if positive and cents <= 0:
        raise ValueError('收退款金额须大于零')
    return cents


def day(value, label):
    value = str(value or '')
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError:
        raise ValueError(f'{label}格式应为 YYYY-MM-DD')
    return value


def number(value, label):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9]\d{0,18}', str(value)) or int(value) > 9223372036854775807:
        raise ValueError(f'{label}不正确')
    return int(value)


def key(value):
    value = str(value or '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,100}', value):
        raise ValueError('缺少有效提交编号，请刷新后重试')
    return value


def canonical(payload):
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def _totals(conn, order_id):
    rows = conn.execute('SELECT kind,COALESCE(SUM(amount_cents),0) AS amount FROM ad_order_payments WHERE order_id=? GROUP BY kind', (order_id,))
    amounts = {row['kind']: row['amount'] for row in rows}
    received, refunded = amounts.get('receipt', 0), amounts.get('refund', 0)
    return received, refunded, received - refunded


def _out(conn, row, today):
    item = dict(row)
    item.pop('request_payload', None)
    item.pop('request_key', None)
    received, refunded, net = _totals(conn, item['id'])
    item.update(received_cents=received, refunded_cents=refunded, net_cents=net,
                outstanding_cents=max(0, item['amount_cents'] - net), refundable_cents=net)
    item['payment_status'] = 'refunded' if refunded and not net else 'paid' if net >= item['amount_cents'] else 'partial' if net else 'unpaid'
    item['status'] = 'cancelled' if item['cancelled'] else 'expired' if today >= item['end_date'] else 'scheduled' if today < item['start_date'] else 'active'
    ad = conn.execute('SELECT name,slot,start_date,end_date,paused FROM ads WHERE id=?', (item['ad_id'],)).fetchone() if item['ad_id'] else None
    item['ad'] = dict(ad) if ad else None
    item['schedule_matches_ad'] = bool(ad and all(ad[field] == item[field] for field in ('slot', 'start_date', 'end_date')))
    item['delivery_covered'] = covered(item, ad)
    return item


PLACEMENTS = {'sponsor': ('sponsor',), 'list_top': ('list_top',), 'footer': ('footer',),
              'list_footer': ('list_top', 'footer'), 'full': ('sponsor', 'list_top', 'footer')}


def covered(order, ad):
    return bool(ad and not ad['paused'] and ad['start_date'] <= order['start_date'] and ad['end_date'] >= order['end_date']
                and set(PLACEMENTS[order['slot']]) <= set(PLACEMENTS[ad['slot']]))


def get(conn, order_id, today):
    row = conn.execute('SELECT * FROM ad_orders WHERE id=?', (order_id,)).fetchone()
    if not row:
        raise ValueError('没有这笔广告订单')
    item = _out(conn, row, today)
    item['payments'] = [dict(row) for row in conn.execute('SELECT id,kind,amount_cents,paid_on,method,reference,note,created_at FROM ad_order_payments WHERE order_id=? ORDER BY paid_on DESC,id DESC', (order_id,))]
    item['renewals'] = [dict(row) for row in conn.execute('SELECT id,order_no,title,start_date,end_date,cancelled FROM ad_orders WHERE renewal_of=? ORDER BY id', (order_id,))]
    parent = conn.execute('SELECT id,order_no FROM ad_orders WHERE id=?', (item['renewal_of'],)).fetchone()
    item['parent'] = dict(parent) if parent else None
    item['deliveries'] = [{**dict(row), 'before_schedule': json.loads(row['before_schedule']), 'after_schedule': json.loads(row['after_schedule'])}
                          for row in conn.execute('SELECT id,before_schedule,after_schedule,applied_at FROM ad_order_deliveries WHERE order_id=? ORDER BY id DESC', (order_id,))]
    return item


def listing(conn, args, today):
    rows = [_out(conn, row, today) for row in conn.execute('SELECT * FROM ad_orders ORDER BY id DESC')]
    summary = {'orders': len(rows), 'contract_cents': 0, 'net_cents': 0, 'outstanding_cents': 0, 'refund_due_cents': 0, 'expiring': 0}
    soon = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    for row in rows:
        summary['net_cents'] += row['net_cents']
        if row['cancelled']:
            summary['refund_due_cents'] += row['net_cents']
        else:
            summary['contract_cents'] += row['amount_cents']
            summary['outstanding_cents'] += row['outstanding_cents']
            summary['expiring'] += row['status'] == 'active' and row['end_date'] <= soon
    query = str(args.get('q') or '').strip().casefold()[:200]
    if query:
        rows = [row for row in rows if query in ' '.join(str(row[field] or '') for field in ('order_no', 'advertiser', 'title', 'contact')).casefold()]
    if args.get('ad_id'):
        ad_id = number(args['ad_id'], '广告编号')
        rows = [row for row in rows if row['ad_id'] == ad_id]
    if args.get('payment_status') in ('unpaid', 'partial', 'paid', 'refunded'):
        rows = [row for row in rows if row['payment_status'] == args['payment_status']]
    if args.get('status') in ('active', 'scheduled', 'expired', 'cancelled'):
        rows = [row for row in rows if row['status'] == args['status']]
    page, size = max(1, int(args.get('page') or 1)), min(100, max(1, int(args.get('size') or 20)))
    return {'items': rows[(page-1)*size:page*size], 'total': len(rows), 'page': page, 'size': size, 'summary': summary, 'currency': 'CNY'}


def save(conn, payload, order_id, today, now, slots):
    conn.execute('BEGIN IMMEDIATE')
    previous = get(conn, order_id, today) if order_id else None
    if previous and previous['cancelled']:
        raise ValueError('已取消订单不能修改，请另建订单')
    version = number(payload.get('version'), '订单版本') if previous else 1
    if previous and previous['version'] != version:
        raise RuntimeError('订单已更新，请刷新后重试')
    slot = str(payload.get('slot') or '')
    if slot not in slots:
        raise ValueError('请选择购买位置')
    start, end = day(payload.get('start_date'), '开始日'), day(payload.get('end_date'), '到期日')
    if start >= end:
        raise ValueError('到期日要晚于开始日，到期当天不计入档期')
    ad_id = number(payload['ad_id'], '广告编号') if payload.get('ad_id') not in (None, '') else None
    if ad_id and not conn.execute('SELECT id FROM ads WHERE id=?', (ad_id,)).fetchone():
        raise ValueError('关联广告不存在')
    parent = number(payload['renewal_of'], '原订单编号') if payload.get('renewal_of') not in (None, '') else None
    amount = money(payload.get('amount'))
    if previous:
        if parent != previous['renewal_of']:
            raise ValueError('不能修改续费来源')
        if amount < previous['net_cents']:
            raise ValueError('订单金额不能低于净实收，请先登记退款')
    fields = {'ad_id': ad_id, 'advertiser': text(payload.get('advertiser'), '广告主', 100, True),
              'contact': text(payload.get('contact'), '联系方式', 200), 'title': text(payload.get('title'), '订单名称', 120, True),
              'slot': slot, 'start_date': start, 'end_date': end, 'amount_cents': amount,
              'notes': text(payload.get('notes'), '备注', 2000), 'renewal_of': parent}
    if previous:
        _validate_renewal(conn, parent, ad_id, start, today, creating=False)
        for child in conn.execute('SELECT ad_id,start_date FROM ad_orders WHERE renewal_of=?', (order_id,)):
            if child['ad_id'] != ad_id or child['start_date'] < end:
                raise ValueError('修改后的广告或档期与已有续费订单冲突，请先核对续费记录')
        conn.execute('UPDATE ad_orders SET '+','.join(field+'=?' for field in fields)+',version=version+1,updated_at=? WHERE id=?', [*fields.values(), now, order_id])
    else:
        request_key, fingerprint = key(payload.get('request_key')), canonical(fields)
        existing = conn.execute('SELECT id,request_payload FROM ad_orders WHERE request_key=?', (request_key,)).fetchone()
        if existing:
            if existing['request_payload'] != fingerprint:
                raise RuntimeError('提交编号已用于另一笔订单，请刷新后重试')
            return get(conn, existing['id'], today)
        _validate_renewal(conn, parent, ad_id, start, today, creating=True)
        order_no = 'AD'+today.replace('-', '')+'-'+secrets.token_hex(4).upper()
        cur = conn.execute('INSERT INTO ad_orders('+','.join(fields)+',order_no,request_key,request_payload,created_at,updated_at) VALUES('+','.join('?' for _ in range(len(fields)+5))+')', [*fields.values(), order_no, request_key, fingerprint, now, now])
        order_id = cur.lastrowid
    return get(conn, order_id, today)


def _validate_renewal(conn, parent, ad_id, start, today, creating):
    if not parent:
        return
    original = get(conn, parent, today)
    if (creating and original['cancelled']) or start < original['end_date']:
        raise ValueError('续费须关联未取消的原订单，且开始日不得早于原订单到期日')
    if original['ad_id'] != ad_id:
        raise ValueError('续费须关联同一广告；更换广告请新建订单')


def payment(conn, order_id, payload, today, now):
    conn.execute('BEGIN IMMEDIATE')
    order = get(conn, order_id, today)
    kind = str(payload.get('kind') or '')
    if kind not in ('receipt', 'refund'):
        raise ValueError('请选择收款或退款')
    amount = money(payload.get('amount'), positive=True)
    paid_on = day(payload.get('paid_on'), '收退款日期')
    if paid_on > today:
        raise ValueError('不能登记未来的收退款')
    fields = {'order_id': order_id, 'kind': kind, 'amount_cents': amount, 'paid_on': paid_on,
              'method': text(payload.get('method'), '收款方式', 40, True),
              'reference': text(payload.get('reference'), '流水号', 120), 'note': text(payload.get('note'), '备注', 500)}
    request_key, fingerprint = key(payload.get('request_key')), canonical(fields)
    existing = conn.execute('SELECT request_payload FROM ad_order_payments WHERE request_key=?', (request_key,)).fetchone()
    if existing:
        if existing['request_payload'] != fingerprint:
            raise RuntimeError('提交编号已用于另一笔收退款，请刷新后重试')
        return get(conn, order_id, today)
    if kind == 'receipt' and (order['cancelled'] or amount > order['outstanding_cents']):
        raise ValueError('已取消订单不能收款，收款也不能超过待收金额')
    if kind == 'refund' and amount > order['net_cents']:
        raise ValueError('退款不能超过净实收金额')
    conn.execute('INSERT INTO ad_order_payments('+','.join(fields)+',request_key,request_payload,created_at) VALUES('+','.join('?' for _ in range(len(fields)+3))+')', [*fields.values(), request_key, fingerprint, now])
    conn.execute('UPDATE ad_orders SET version=version+1,updated_at=? WHERE id=?', (now, order_id))
    return get(conn, order_id, today)


def cancel(conn, order_id, payload, today, now):
    conn.execute('BEGIN IMMEDIATE')
    order = get(conn, order_id, today)
    if order['cancelled']:
        return order
    if number(payload.get('version'), '订单版本') != order['version']:
        raise RuntimeError('订单已更新，请刷新后重试')
    conn.execute('UPDATE ad_orders SET cancelled=1,version=version+1,updated_at=? WHERE id=?', (now, order_id))
    return get(conn, order_id, today)

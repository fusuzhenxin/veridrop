"""Order reports, placement calendar, and explicit order-to-ad delivery plans."""
from calendar import monthrange
from datetime import date, timedelta
import hashlib
import json
import re

import ad_analytics
import ad_orders

CAPACITY = {'sponsor': 2, 'list_top': 4, 'footer': None}
LABELS = {'sponsor': '全站左右角标', 'list_top': '列表页顶部', 'footer': '全站页脚'}
TRACKING_PLACEMENTS = {'sponsor': 'sides', 'list_top': 'list', 'footer': 'footer'}


def totals(rows):
    impressions = sum(row['impressions'] for row in rows)
    clicks = sum(row['clicks'] for row in rows)
    return {'impressions': impressions, 'clicks': clicks, 'ctr': round(clicks / impressions * 100, 2) if impressions else None}


def breakdown(rows):
    locations, daily = {}, {}
    for row in rows:
        page, region, action = ad_analytics.source_labels(row['path'], row['placement'])
        key = (page, region, row['placement'])
        location = locations.setdefault(key, {'page': page, 'page_label': ad_analytics.PAGE_NAMES[page], 'region': region,
                                              'placement': row['placement'], 'rows': [], 'paths': set(),
                                              'detail_clicks': 0, 'outbound_clicks': 0, 'unclassified_clicks': 0})
        location['rows'].append(row); location['paths'].add(row['path'])
        location[{'查看详情': 'detail_clicks', '跳转官网': 'outbound_clicks'}.get(action, 'unclassified_clicks')] += row['clicks']
        daily.setdefault(row['day'], []).append(row)
    result = []
    for location in locations.values():
        items = location.pop('rows')
        result.append({**location, 'paths': sorted(location['paths']), **totals(items)})
    result.sort(key=lambda row: (list(ad_analytics.PAGE_NAMES).index(row['page']), row['region'], row['placement']))
    return {'summary': totals(rows), 'pages': [{'page': key, 'page_label': label, **totals([row for row in rows if ad_analytics.source_labels(row['path'], row['placement'])[0] == key])}
                                            for key, label in ad_analytics.PAGE_NAMES.items()],
            'locations': result, 'daily': [{'day': day, **totals(items)} for day, items in sorted(daily.items())]}


def order_report(conn, order_id, mode, today, now):
    order = ad_orders.get(conn, order_id, today)
    if not order['ad_id']:
        raise ValueError('请先为订单关联投放广告，再生成效果报告')
    if mode not in ('human', 'all', 'ai'):
        raise ValueError('统计口径不正确')
    rows = [dict(row) for row in conn.execute('SELECT * FROM ad_metrics WHERE ad_id=? AND day>=? AND day<? AND day<=? ORDER BY day,path,placement',
                                             (order['ad_id'], order['start_date'], order['end_date'], today))]
    allowed = lambda row: mode == 'all' or row['audience'] == ('human' if mode == 'human' else 'ai')
    positions = {TRACKING_PLACEMENTS[slot] for slot in ad_orders.PLACEMENTS[order['slot']]}
    banner = [row for row in rows if row['surface'] == 'banner' and row['placement'] in positions]
    directory = [row for row in rows if row['surface'] == 'directory']
    unknown = [row for row in rows if row['surface'] == 'banner' and row['placement'] in ('legacy', 'unspecified')]
    considered = banner + directory + unknown
    overlaps = [dict(row) for row in conn.execute('SELECT id,order_no FROM ad_orders WHERE id!=? AND ad_id=? AND cancelled=0 AND start_date<? AND end_date>?',
                                                (order_id, order['ad_id'], order['end_date'], order['start_date']))]
    notes = ['按订单约定位置及北京时间档期统计，开始日包含，到期日 00:00 不计入；仅统计截至生成日的已记录事件。',
             '广告位交付与站内收录入口分开，不相加作为广告交付；曝光和点击为事件次数，不代表独立访客、注册或成交。',
             '曝光需至少 50% 可见并持续 1 秒，同次页面访问的同一入口最多记录一次；点击率为点击次数 ÷ 曝光次数，曝光为零时不计算。',
             '过滤后流量排除已识别的 AI、自动化及来源未知事件，不保证全部为真人；历史未分类数据单列，不猜测页面或广告位。',
             '逐日表仅列有记录的日期；没有记录不能用于推断历史曝光。']
    if overlaps:
        notes.append('同一广告在此档期存在其他未取消订单；数据按广告、日期和位置汇总，无法将重叠事件唯一归到某一笔订单。')
    if order['cancelled']:
        notes.append('此订单已取消，报告保留该订单约定档期内的已记录数据，不代表取消后的履约承诺。')
    through = min(today, (date.fromisoformat(order['end_date']) - timedelta(days=1)).isoformat())
    return {'order': {key: order[key] for key in ('id', 'order_no', 'title', 'advertiser', 'ad_id', 'slot', 'start_date', 'end_date', 'cancelled')},
            'ad_name': order['ad']['name'] if order['ad'] else '', 'mode': mode, 'generated_at': now,
            'range': {'start': order['start_date'], 'end_exclusive': order['end_date'], 'through': through if through >= order['start_date'] else None, 'timezone': 'Asia/Shanghai'},
            'banner': breakdown([row for row in banner if allowed(row)]), 'directory': breakdown([row for row in directory if allowed(row)]),
            'unattributed': totals(unknown), 'excluded': {'ai': totals([row for row in considered if row['audience'] == 'ai']),
                                                       'bot': totals([row for row in considered if row['audience'] == 'bot']),
                                                       'unknown': totals([row for row in considered if row['audience'] in ('unknown', 'legacy')])},
            'overlapping_orders': overlaps, 'notes': notes}


def calendar(conn, month, today):
    if not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', str(month)):
        raise ValueError('月份格式应为 YYYY-MM')
    try:
        first = date.fromisoformat(month + '-01')
        last = first.replace(day=monthrange(first.year, first.month)[1])
        following = (last + timedelta(days=1)).isoformat()
    except (ValueError, OverflowError):
        raise ValueError('请选择有效月份')
    ads = [dict(row) for row in conn.execute('SELECT id,name,slot,start_date,end_date,paused FROM ads WHERE paused=0 AND start_date<? AND end_date>=? ORDER BY start_date,id', (following, first.isoformat()))]
    orders, order_ads = [], {}
    for row in conn.execute('SELECT id,order_no,title,slot,start_date,end_date,ad_id FROM ad_orders WHERE cancelled=0 AND start_date<? AND end_date>? ORDER BY start_date,id', (following, first.isoformat())):
        ad = conn.execute('SELECT * FROM ads WHERE id=?', (row['ad_id'],)).fetchone() if row['ad_id'] else None
        if not ad_orders.covered(row, ad):
            orders.append(dict(row))
            order_ads[row['id']] = dict(ad) if ad else None
    days = []
    for offset in range(last.day):
        day = (first + timedelta(days=offset)).isoformat()
        occupied = [row for row in ads if row['start_date'] <= day < row['end_date']]
        placements = []
        for slot, capacity in CAPACITY.items():
            matching = [row['id'] for row in occupied if slot in ad_orders.PLACEMENTS[row['slot']]]
            placements.append({'slot': slot, 'label': LABELS[slot], 'used': len(matching), 'capacity': capacity,
                               'remaining': max(0, capacity - len(matching)) if capacity is not None else None, 'ad_ids': matching})
        def pending(row):
            ad = order_ads[row['id']]
            return row['start_date'] <= day < row['end_date'] and not (ad and not ad['paused'] and ad['start_date'] <= day < ad['end_date']
                       and set(ad_orders.PLACEMENTS[row['slot']]) <= set(ad_orders.PLACEMENTS[ad['slot']]))
        days.append({'day': day, 'placements': placements, 'pending_order_ids': [row['id'] for row in orders if pending(row)],
                     'ending_ad_ids': [row['id'] for row in ads if row['end_date'] == day]})
    return {'month': month, 'today': today, 'week_start': first.weekday(), 'days': days, 'ads': ads, 'pending_orders': orders,
            'note': '已安排只计算未暂停广告的实际档期，套餐计入各物理位置；待安排订单不占名额。到期日 00:00 撤下。'}


def delivery_plan(conn, order_id, today, capacity):
    order = ad_orders.get(conn, order_id, today)
    ad_row = conn.execute('SELECT * FROM ads WHERE id=?', (order['ad_id'],)).fetchone() if order['ad_id'] else None
    ad = dict(ad_row) if ad_row else None
    current = {key: ad[key] for key in ('slot', 'start_date', 'end_date', 'paused')} if ad else None
    proposed = {'slot': order['slot'], 'start_date': order['start_date'], 'end_date': order['end_date'], 'paused': ad['paused'] if ad else False}
    reasons, warnings = [], []
    up_to_date = ad_orders.covered(order, ad)
    if up_to_date:
        proposed = dict(current)
    if order['cancelled']:
        reasons.append('订单已取消，不能更新投放')
    if not ad:
        reasons.append('请先关联已有广告')
    elif ad['paused']:
        reasons.append('关联广告已暂停，请先到投放管理核对并恢复，再同步档期')
    if order['end_date'] <= today:
        reasons.append('订单档期已结束，不能用于更新后续投放')
    if ad and not up_to_date:
        if order['end_date'] < ad['end_date']:
            reasons.append('关联广告已有更晚档期，不能用本订单覆盖，请核对其他订单')
        elif ad['slot'] != order['slot'] and ad['end_date'] > today:
            reasons.append('现有档期尚未结束，不能提前更换广告位置；请原档结束后同步，或另建后续广告')
        elif ad['slot'] == order['slot'] and order['start_date'] <= ad['end_date'] and order['end_date'] >= ad['start_date']:
            proposed['start_date'] = min(ad['start_date'], order['start_date'])
            proposed['end_date'] = max(ad['end_date'], order['end_date'])
        elif ad['end_date'] > today:
            reasons.append('新旧档期之间有空档，直接延长会多展示空档日期；请原档结束后同步，或另建后续广告')
    if order['outstanding_cents']:
        warnings.append('此订单仍有待收款。本次仅更新广告档期，不会改变收款状态。')
    availability = capacity(conn, proposed['slot'], proposed['start_date'], proposed['end_date'], order['ad_id'] or 0)
    if not availability['available'] and not up_to_date:
        reasons.append('所选档期有广告位已满，请先调整日期或投放位置')
    token = hashlib.sha256(ad_orders.canonical({'order_id': order_id, 'version': order['version'], 'ad': ad, 'proposed': proposed}).encode()).hexdigest()
    return {'order_id': order_id, 'ad_id': order['ad_id'], 'ad_name': ad['name'] if ad else '', 'current': current,
            'proposed': proposed, 'availability': availability, 'up_to_date': up_to_date, 'can_apply': not reasons and not up_to_date,
            'reasons': reasons, 'warnings': warnings, 'preview_token': token}


def apply_delivery(conn, order_id, payload, today, now, capacity, save_ad):
    conn.execute('BEGIN IMMEDIATE')
    request_key = ad_orders.key(payload.get('request_key'))
    token = str(payload.get('preview_token') or '')
    previous = conn.execute('SELECT order_id,preview_token FROM ad_order_deliveries WHERE request_key=?', (request_key,)).fetchone()
    if previous:
        if previous['order_id'] != order_id or previous['preview_token'] != token:
            raise RuntimeError('提交编号已被使用，请重新检查投放安排')
        return ad_orders.get(conn, order_id, today)
    plan = delivery_plan(conn, order_id, today, capacity)
    if token != plan['preview_token']:
        raise RuntimeError('订单或广告已发生变化，请重新检查投放安排')
    if not plan['can_apply']:
        raise ValueError('；'.join(plan['reasons']) or '当前广告已覆盖订单档期，无需重复更新')
    ad = dict(conn.execute('SELECT * FROM ads WHERE id=?', (plan['ad_id'],)).fetchone())
    save_ad(conn, {**ad, **plan['proposed']}, plan['ad_id'])
    conn.execute('INSERT INTO ad_order_deliveries(order_id,request_key,preview_token,before_schedule,after_schedule,applied_at) VALUES(?,?,?,?,?,?)',
                 (order_id, request_key, token, json.dumps(plan['current']), json.dumps(plan['proposed']), now))
    conn.execute('UPDATE ad_orders SET version=version+1,updated_at=? WHERE id=?', (now, order_id))
    return ad_orders.get(conn, order_id, today)

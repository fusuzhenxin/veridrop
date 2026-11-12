import os
from concurrent.futures import ThreadPoolExecutor
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ops_db


class AdOrdersTest(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory(prefix='ad-orders-')
        self.addCleanup(root.cleanup)
        env = patch.dict(os.environ, {'OPS_DB': str(Path(root.name) / 'ops.sqlite')})
        env.start(); self.addCleanup(env.stop)
        clock = patch.object(ops_db, 'today', return_value='2026-11-11')
        clock.start(); self.addCleanup(clock.stop)
        self.ad = ops_db.save_ad({'slot': 'footer', 'name': '订单关联广告', 'target_url': 'https://example.com/?aff=KEEP', 'start_date': '2026-11-01', 'end_date': '2026-12-01'})

    def payload(self, **extra):
        return {'advertiser': '测试广告主', 'contact': '微信 test', 'title': '十一月页脚', 'ad_id': self.ad['id'],
                'slot': 'footer', 'start_date': '2026-11-01', 'end_date': '2026-12-01', 'amount': '100.10',
                'request_key': secrets.token_hex(16), **extra}

    def receipt(self, order, amount='40.05', **extra):
        return ops_db.record_ad_payment(order['id'], {'kind': 'receipt', 'amount': amount, 'paid_on': '2026-11-11', 'method': '微信', 'request_key': secrets.token_hex(16), **extra})

    def test_create_edit_and_orders_never_change_live_ads(self):
        before = ops_db.get_ad(self.ad['id'])
        payload = self.payload(slot='full', start_date='2026-12-01', end_date='2027-01-01')
        order = ops_db.save_ad_order(payload)
        self.assertFalse(order['schedule_matches_ad'])
        self.assertEqual(order['amount_cents'], 10010)
        self.assertEqual(order['payment_status'], 'unpaid')
        self.assertEqual(order['status'], 'scheduled')
        self.assertEqual(ops_db.get_ad(self.ad['id']), before)
        changed = ops_db.save_ad_order({**payload, 'version': order['version'], 'amount': '200'}, order['id'])
        self.assertEqual(changed['version'], 2)
        with self.assertRaises(RuntimeError):
            ops_db.save_ad_order({**payload, 'version': 1}, order['id'])

    def test_installments_refunds_and_exact_amounts(self):
        order = ops_db.save_ad_order(self.payload())
        partial = self.receipt(order)
        self.assertEqual((partial['net_cents'], partial['outstanding_cents'], partial['payment_status']), (4005, 6005, 'partial'))
        paid = self.receipt(order, '60.05')
        self.assertEqual(paid['payment_status'], 'paid')
        with self.assertRaises(ValueError): self.receipt(order, '0.01')
        with self.assertRaises(ValueError): self.receipt(order, '100.11', kind='refund')
        refund = self.receipt(order, '0.10', kind='refund')
        self.assertEqual((refund['net_cents'], refund['outstanding_cents']), (10000, 10))
        with self.assertRaises(ValueError):
            ops_db.save_ad_order(self.payload(version=refund['version'], amount='99'), order['id'])
        self.assertEqual(len(refund['payments']), 3)

    def test_retries_are_idempotent_but_payload_reuse_is_rejected(self):
        payload = self.payload()
        order = ops_db.save_ad_order(payload)
        self.assertEqual(ops_db.save_ad_order(payload)['id'], order['id'])
        with self.assertRaises(RuntimeError): ops_db.save_ad_order({**payload, 'amount': '5'})
        payment_key = secrets.token_hex(16)
        self.receipt(order, request_key=payment_key)
        repeated = self.receipt(order, request_key=payment_key)
        self.assertEqual(len(repeated['payments']), 1)
        self.assertEqual(repeated['net_cents'], 4005)
        with self.assertRaises(RuntimeError): self.receipt(order, '1', request_key=payment_key)

    def test_cancellation_keeps_receipts_and_allows_refunds(self):
        order = self.receipt(ops_db.save_ad_order(self.payload()), '100.10')
        cancelled = ops_db.cancel_ad_order(order['id'], {'version': order['version']})
        self.assertEqual(cancelled['status'], 'cancelled')
        summary = ops_db.list_ad_orders({})['summary']
        self.assertEqual(summary['contract_cents'], 0)
        self.assertEqual(summary['outstanding_cents'], 0)
        self.assertEqual(summary['refund_due_cents'], 10010)
        with self.assertRaises(ValueError): self.receipt(order, '1')
        refunded = self.receipt(order, '100.10', kind='refund')
        self.assertEqual(refunded['payment_status'], 'refunded')
        self.assertEqual(ops_db.list_ad_orders({})['summary']['refund_due_cents'], 0)
        self.assertFalse(ops_db.get_ad(self.ad['id'])['paused'])

    def test_renewal_records_keep_previous_contract(self):
        parent = ops_db.save_ad_order(self.payload())
        payload = self.payload(renewal_of=parent['id'], start_date='2026-12-01', end_date='2027-01-01')
        child = ops_db.save_ad_order(payload)
        self.assertEqual(child['parent']['id'], parent['id'])
        self.assertEqual(ops_db.get_ad_order(parent['id'])['renewals'][0]['id'], child['id'])
        self.assertEqual(ops_db.get_ad_order(parent['id'])['end_date'], '2026-12-01')
        with self.assertRaises(ValueError): ops_db.save_ad_order({**payload, 'start_date': '2026-11-20', 'request_key': secrets.token_hex(16)})
        with self.assertRaises(ValueError): ops_db.save_ad_order({**payload, 'ad_id': None, 'request_key': secrets.token_hex(16)})
        with self.assertRaises(ValueError): ops_db.save_ad_order({**payload, 'start_date': '2026-11-20', 'version':child['version']}, child['id'])
        with self.assertRaises(ValueError): ops_db.save_ad_order(self.payload(end_date='2026-12-02',version=parent['version']), parent['id'])

    def test_validation_filtering_and_global_summary(self):
        first = ops_db.save_ad_order(self.payload())
        self.receipt(first)
        ops_db.save_ad_order(self.payload(advertiser='另一个广告主', amount='0'))
        data = ops_db.list_ad_orders({'q': '另一个', 'size': 1})
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['summary']['orders'], 2)
        self.assertEqual(ops_db.list_ad_orders({'payment_status': 'partial'})['total'], 1)
        for amount in ('-1', 'NaN', 'Infinity', '0.001', '100000000', True, ''):
            with self.assertRaises(ValueError): ops_db.save_ad_order(self.payload(amount=amount))
        with self.assertRaises(ValueError): self.receipt(first, paid_on='2026-11-12')
        with self.assertRaises(ValueError): self.receipt(first, '0')
        with self.assertRaises(ValueError): ops_db.save_ad_order(self.payload(ad_id=999999))
        with self.assertRaises(ValueError): ops_db.save_ad_order(self.payload(start_date='2026-1-1'))

    def test_concurrent_receipts_cannot_overcollect(self):
        order = ops_db.save_ad_order(self.payload(amount='100'))
        def attempt(_):
            try:
                self.receipt(order, '75')
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(attempt, range(2)))
        self.assertEqual(sorted(outcomes), [False, True])
        self.assertEqual(ops_db.get_ad_order(order['id'])['net_cents'], 7500)


if __name__ == '__main__': unittest.main()

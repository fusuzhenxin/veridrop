import json
import os
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ops_db


class AdCampaignsTest(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory(prefix='ad-campaigns-'); self.addCleanup(root.cleanup)
        env = patch.dict(os.environ, {'OPS_DB': str(Path(root.name) / 'ops.sqlite')}); env.start(); self.addCleanup(env.stop)
        clock = patch.object(ops_db, 'today', return_value='2026-11-11'); clock.start(); self.addCleanup(clock.stop)
        conn = ops_db.open_db(); ops_db.init_schema(conn); conn.execute('DELETE FROM ads'); conn.commit(); conn.close()

    def ad(self, slot='footer', start='2026-11-01', end='2026-12-01', **extra):
        return ops_db.save_ad({'name':'广告测试', 'slot':slot, 'start_date':start, 'end_date':end,
                              'target_url':'https://example.com/?aff=KEEP&utm_source=veridrop.cn', **extra})

    def order(self, ad, start='2026-11-01', end='2026-12-01', **extra):
        return ops_db.save_ad_order({'title':'订单测试','advertiser':'广告主','contact':'private@example.com','ad_id':ad['id'] if ad else None,
                                    'slot':ad['slot'] if ad else 'footer','start_date':start,'end_date':end,'amount':'100',
                                    'request_key':secrets.token_hex(16),**extra})

    def apply(self, order, plan=None, **extra):
        plan = plan or ops_db.ad_delivery_preview(order['id'])
        return ops_db.apply_ad_delivery(order['id'], {'preview_token':plan['preview_token'],'request_key':secrets.token_hex(16),**extra})

    def metric(self, ad, day, path, placement, imp, clicks, audience='human', surface='banner'):
        conn = ops_db.open_db()
        conn.execute('INSERT INTO ad_metrics VALUES(?,?,?,?,?,?,?,?,?)', (ad['id'],day,path,placement,surface,audience,'test',imp,clicks))
        conn.commit(); conn.close()

    def test_report_exclusive_end_placements_audiences_and_private_fields(self):
        ad = self.ad(); order = self.order(ad, end='2026-11-11')
        self.metric(ad,'2026-11-10','/','footer',100,4)
        self.metric(ad,'2026-11-10','/list','footer',50,2)
        self.metric(ad,'2026-11-10','/reputation','footer',20,1)
        self.metric(ad,'2026-11-10','/','sides',999,50)  # Not purchased.
        self.metric(ad,'2026-11-11','/','footer',999,50)  # Exclusive end.
        self.metric(ad,'2026-11-10','/list','directory-visit',30,3,surface='directory')
        self.metric(ad,'2026-11-10','/','footer',5,1,audience='ai')
        self.metric(ad,'2026-11-10','/','legacy',9,1,audience='legacy')
        report = ops_db.ad_order_report(order['id'],{})
        self.assertEqual(report['banner']['summary'],{'impressions':170,'clicks':7,'ctr':4.12})
        self.assertEqual(report['directory']['summary']['clicks'],3)
        self.assertEqual(report['unattributed']['impressions'],9)
        self.assertEqual(report['excluded']['ai']['impressions'],5)
        self.assertEqual(report['range']['through'],'2026-11-10')
        self.assertNotIn('private@example.com',json.dumps(report))
        self.assertNotIn('amount_cents',report['order'])
        self.assertEqual(ops_db.ad_order_report(order['id'],{'mode':'all'})['banner']['summary']['impressions'],175)
        self.assertEqual(ops_db.ad_order_report(order['id'],{'mode':'ai'})['banner']['summary']['impressions'],5)

    def test_report_future_no_ad_and_overlap_are_explicit(self):
        ad = self.ad(); first = self.order(ad,start='2026-12-01',end='2027-01-01')
        self.order(ad,start='2026-12-10',end='2027-01-01')
        report = ops_db.ad_order_report(first['id'],{})
        self.assertIsNone(report['range']['through'])
        self.assertIsNone(report['banner']['summary']['ctr'])
        self.assertEqual(len(report['overlapping_orders']),1)
        with self.assertRaises(ValueError): ops_db.ad_order_report(self.order(None)['id'],{})

    def test_calendar_packages_boundaries_and_pending_do_not_reserve(self):
        ad = self.ad(slot='full',start='2026-11-10',end='2026-11-12')
        pending = self.order(ad,end='2026-11-15',start='2026-11-10')
        self.ad(slot='sponsor',start='2026-11-10',end='2026-11-12',paused=True)
        month = ops_db.ad_calendar({'month':'2026-11'})
        days = {row['day']:row for row in month['days']}
        self.assertEqual(len(days),30)
        self.assertEqual(days['2026-11-10']['placements'][0]['used'],1)
        self.assertEqual(days['2026-11-10']['pending_order_ids'],[])
        self.assertEqual(days['2026-11-12']['placements'][0]['used'],0)
        self.assertEqual(days['2026-11-12']['ending_ad_ids'],[ad['id']])
        self.assertEqual(days['2026-11-12']['pending_order_ids'],[pending['id']])
        self.assertEqual(len(ops_db.ad_calendar({'month':'2028-02'})['days']),29)
        with self.assertRaises(ValueError): ops_db.ad_calendar({'month':'2026-13'})

    def test_contiguous_renewal_extends_without_changing_content_or_double_apply(self):
        ad = self.ad(); parent = self.order(ad)
        child = self.order(ad,start='2026-12-01',end='2027-01-01',renewal_of=parent['id'])
        plan = ops_db.ad_delivery_preview(child['id'])
        self.assertEqual(ops_db.get_ad(ad['id'])['end_date'],'2026-12-01')
        self.assertEqual(plan['proposed']['start_date'],'2026-11-01')
        key = secrets.token_hex(16)
        applied = self.apply(child,plan,request_key=key)
        self.assertTrue(applied['delivery_covered'])
        current = ops_db.get_ad(ad['id'])
        self.assertEqual(current['end_date'],'2027-01-01')
        for field in ('name','target_url','description','image_url','paused'):
            self.assertEqual(current[field],ad[field])
        self.assertEqual(len(self.apply(child,plan,request_key=key)['deliveries']),1)
        unchanged = ops_db.ad_delivery_preview(parent['id'])
        self.assertTrue(unchanged['up_to_date'])
        self.assertEqual(unchanged['proposed'],unchanged['current'])

    def test_conflict_and_occupancy_change_after_preview_cannot_overbook(self):
        ad = self.ad(slot='sponsor'); order = self.order(ad,start='2026-12-01',end='2027-01-01')
        plan = ops_db.ad_delivery_preview(order['id']); self.assertTrue(plan['can_apply'])
        self.ad(slot='sponsor',start='2026-12-01',end='2027-01-01')
        self.ad(slot='sponsor',start='2026-12-01',end='2027-01-01')
        with self.assertRaises(ValueError): self.apply(order,plan)
        self.assertEqual(ops_db.get_ad(ad['id'])['end_date'],'2026-12-01')
        self.assertFalse(ops_db.ad_delivery_preview(order['id'])['can_apply'])

    def test_stale_preview_gap_position_pause_and_cancellation(self):
        ad = self.ad(); order = self.order(ad,start='2026-12-01',end='2027-01-01')
        plan = ops_db.ad_delivery_preview(order['id'])
        ops_db.save_ad({**ad,'description':'新的文案'},ad['id'])
        with self.assertRaises(RuntimeError): self.apply(order,plan)
        self.assertFalse(ops_db.ad_delivery_preview(self.order(ad,start='2026-12-02',end='2027-01-01')['id'])['can_apply'])
        self.assertFalse(ops_db.ad_delivery_preview(self.order(ad,start='2026-12-01',end='2027-01-01',slot='full')['id'])['can_apply'])
        ops_db.set_ad_paused(ad['id'],True)
        self.assertFalse(ops_db.ad_delivery_preview(order['id'])['can_apply'])
        ops_db.cancel_ad_order(order['id'],{'version':order['version']})
        self.assertFalse(ops_db.ad_delivery_preview(order['id'])['can_apply'])


if __name__ == '__main__': unittest.main()

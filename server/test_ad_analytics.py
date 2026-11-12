"""Regression checks: legacy preservation, bot filtering, attribution and retries."""
import sqlite3
import unittest
import ad_analytics as analytics
from traffic_identity import classify


class AdAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
          CREATE TABLE ads(id INTEGER PRIMARY KEY,name TEXT,slot TEXT,target_url TEXT,paused INTEGER,start_date TEXT,end_date TEXT);
          CREATE TABLE ad_daily(ad_id INTEGER,day TEXT,impressions INTEGER,clicks INTEGER,PRIMARY KEY(ad_id,day));
          INSERT INTO ads VALUES(1,'测试广告','footer','https://api.example.com/register?aff=test',0,'2026-01-01','2027-01-01');
          INSERT INTO ad_daily VALUES(1,'2026-11-10',12,2);
        """)
        analytics.ensure_schema(self.db)

    def report(self, **kwargs):
        return analytics.report(self.db, {'start':'2026-11-10','end':'2026-11-11', **kwargs}, '2026-11-11')

    def test_migration_is_idempotent_and_legacy_is_never_human(self):
        analytics.ensure_schema(self.db)
        self.assertEqual(self.report(mode='all')['summary']['impressions'],12)
        self.assertEqual(self.report()['summary']['impressions'],0)
        self.assertEqual(self.report()['unknown']['clicks'],2)

    def test_human_ai_automation_and_unknown_stay_separate(self):
        for agent, extra in [('Mozilla/5.0 Chrome/130.0',{}),('GPTBot/1.2',{}),('Mozilla/5.0 Chrome/130.0',{'automated':True}),('',{})]:
            analytics.record(self.db,1,'impressions','2026-11-11',agent,extra)
        data=self.report(mode='all')
        self.assertEqual(data['all']['impressions'],16)
        self.assertEqual(data['human']['impressions'],1)
        self.assertEqual(data['ai']['impressions'],1)
        self.assertEqual(data['excluded']['impressions'],2)
        self.assertEqual(data['unknown']['impressions'],13)

    def test_directory_exact_host_source_and_retry_dedup(self):
        body={'surface':'directory','target_url':'https://api.example.com/','action':'click',
              'event_id':'a234567890123456789','path':'/list?key=secret#private','placement':'directory-visit'}
        for _ in range(2): analytics.collect(self.db,body,'2026-11-11','Mozilla/5.0 Chrome/130.0')
        data=self.report(surface='directory')
        self.assertEqual(data['summary']['clicks'],1)
        self.assertIsNone(data['summary']['ctr'])
        self.assertEqual(data['sources'][0]['path'],'/list')
        self.assertEqual(data['sources'][0]['placement'],'directory-visit')
        analytics.collect(self.db,{**body,'target_url':'https://example.com/','event_id':'b234567890123456789'},'2026-11-11','Mozilla/5.0')
        self.assertEqual(self.report(surface='directory')['summary']['clicks'],1)
        self.assertEqual(self.db.execute('SELECT clicks FROM ad_daily').fetchone()[0],2)

    def test_paused_expired_range_and_filters(self):
        self.db.execute('UPDATE ads SET paused=1')
        self.assertIsNone(analytics.record(self.db,1,'clicks','2026-11-11','GPTBot/1.2'))
        with self.assertRaises(ValueError): self.report(start='2026-12-01')
        self.assertEqual(self.report(ad_id=999,mode='all')['summary']['impressions'],0)

    def test_shared_rules_cover_user_initiated_ai_and_normal_referrals(self):
        for agent in ['ChatGPT-User/1.0','OAI-SearchBot/1.0','Claude-User/1.0','Claude-SearchBot/1.0','Perplexity-User/1.0','GPTBot/1.2']:
            self.assertEqual(classify(agent)[0],'ai',agent)
        self.assertEqual(classify('Mozilla/5.0 Safari/537.36')[0],'human')

    def test_page_drilldown_keeps_other_page_totals_and_actions_reconcile(self):
        for path, place, action in [('/', 'home-rec-row', 'impressions'),
                                    ('/', 'home-rec', 'clicks'),
                                    ('/', 'home-rec-visit', 'clicks'),
                                    ('/list', 'directory-row', 'impressions'),
                                    ('/reputation', 'vote-row', 'impressions'),
                                    ('/reputation', 'vote', 'clicks')]:
            analytics.record(self.db, 1, action, '2026-11-11', 'Mozilla/5.0 Chrome/130.0',
                             {'path': path, 'placement': place, 'surface': 'directory'})
        data = self.report(page='home')
        self.assertEqual(data['summary']['impressions'], 1)
        self.assertEqual(data['summary']['clicks'], 2)
        self.assertEqual(data['summary']['ctr'], 200)
        pages = {r['page']: r for r in data['pages']}
        self.assertEqual(pages['stations']['impressions'], 1)
        self.assertEqual(pages['vote']['clicks'], 1)
        self.assertEqual(len(data['locations']), 1)
        row = data['locations'][0]
        self.assertEqual(row['region'], '推荐站点')
        self.assertEqual(row['detail_clicks'], 1)
        self.assertEqual(row['outbound_clicks'], 1)
        self.assertEqual(row['unclassified_clicks'], 0)
        self.assertEqual(data['daily'][-1]['clicks'], 2)
        legacy = self.report(mode='all', page='unknown')['locations'][0]
        self.assertEqual(legacy['unclassified_clicks'], 2)
        self.assertEqual(legacy['detail_clicks'] + legacy['outbound_clicks'] + legacy['unclassified_clicks'], legacy['clicks'])


if __name__ == '__main__': unittest.main()

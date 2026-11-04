import unittest
from dataset import build_dataset, LABELS

class DataTests(unittest.TestCase):
    def test_split_counts_balance_and_no_repeated_texts(self):
        data=build_dataset()
        self.assertEqual({s:len(rows) for s,rows in data.items()},{'train':128,'validation':32,'test':48})
        texts=[r['text'].strip().casefold() for rows in data.values() for r in rows]
        self.assertEqual(len(texts),len(set(texts)))
        for split,rows in data.items():
            for label in LABELS:
                for language in ('ru','kk'):
                    self.assertEqual(sum(r['label']==label and r['language']==language for r in rows),{'train':8,'validation':2,'test':3}[split])
    def test_source_is_always_explicitly_synthetic(self):
        for rows in build_dataset().values():
            for r in rows:
                self.assertEqual(r['source'],'authored_synthetic')
                self.assertEqual(LABELS[r['label_id']],r['label'])
    def test_final_audit_is_new_and_balanced(self):
        from final_audit import build_audit
        audit=build_audit()
        self.assertEqual(len(audit),64)
        for label in LABELS:
            for language in ('ru','kk'):
                self.assertEqual(sum(r['label']==label and r['language']==language for r in audit),4)

if __name__=='__main__':unittest.main()

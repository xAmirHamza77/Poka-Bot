import tempfile
import unittest
from pathlib import Path
from app.services.storage_service import StorageService

class PokaBrandingTests(unittest.TestCase):
    def test_existing_assistant_name_migrates_with_custom_model_and_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); storage = StorageService(root)
            storage.save_bots([{'id': 'existing-assistant', 'name': 'Open Dots Assistant', 'model': 'my-custom-model', 'system_prompt': 'My custom instructions'}, {'id': 'custom', 'name': 'My research assistant', 'model': 'research'}])
            storage.add_message({'id': 'existing-message', 'thread_id': 'existing-assistant', 'sender': 'user', 'text': 'Keep this conversation'})
            reopened = StorageService(root)
            bots = reopened.get_bots()
            self.assertEqual(bots[0]['name'], 'Poka')
            self.assertEqual(bots[0]['model'], 'my-custom-model')
            self.assertEqual(bots[0]['system_prompt'], 'My custom instructions')
            self.assertEqual(bots[1]['name'], 'My research assistant')
            self.assertEqual(reopened.get_messages('existing-assistant')[0]['text'], 'Keep this conversation')
    def test_existing_database_is_reused_and_new_workspaces_use_poka_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); service = StorageService(root)
            self.assertEqual(service.db_path.name, 'poka.sqlite3')
            with service.database.connect() as db:
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            service.db_path.rename(root/'open-dots.sqlite3')
            reopened = StorageService(root)
            self.assertEqual(reopened.db_path.name, 'open-dots.sqlite3')
            self.assertTrue(reopened.get_bots())
            self.assertFalse((root/'poka.sqlite3').exists())

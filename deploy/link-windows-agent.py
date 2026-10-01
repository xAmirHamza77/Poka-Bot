"""Called by the setup wizard with credentials supplied only via environment."""
import os
from app.services.storage_service import storage_service
storage_service.save_settings({
    'computer_connection': 'windows',
    'computer_remote_url': 'http://127.0.0.1:8765',
    'computer_remote_token': os.environ.pop('POKA_SETUP_AGENT_TOKEN'),
})

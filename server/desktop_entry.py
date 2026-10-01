"""Bundled desktop backend; no development reloader or external Python required."""
import multiprocessing
import uvicorn

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from app.main import app
    from app.config import settings
    uvicorn.run(app, host="127.0.0.1", port=settings.PORT, log_level="warning")

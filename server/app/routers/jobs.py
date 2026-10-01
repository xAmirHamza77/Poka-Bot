from fastapi import APIRouter, HTTPException
from app.services.task_service import task_service
router = APIRouter(prefix='/api/v1/jobs', tags=['background jobs'])

@router.get('')
async def list_jobs(thread_id: str | None = None):
    return task_service.list(thread_id)

@router.get('/{job_id}')
async def get_job(job_id: str):
    job = task_service.get(job_id)
    if not job:
        raise HTTPException(404, 'Job not found.')
    return job

@router.post('/{job_id}/cancel')
async def cancel_job(job_id: str):
    if not task_service.get(job_id):
        raise HTTPException(404, 'Job not found.')
    task_service.cancel(job_id)
    return task_service.get(job_id)

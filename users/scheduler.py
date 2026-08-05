import datetime
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
import os
from fastapi import APIRouter, BackgroundTasks
import logging

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter()

# The function that performs the action
async def send_date_to_endpoint():
    # Get the current date in YYYY-MM-DD format
    current_date = datetime.datetime.now().strftime("%Y-%m-%d")
    print(f"Sending date: {current_date}")
    
    # Replace with your actual endpoint
    url = f"{api_base_url}hms/users/data/whatsapp/receive-date"
    try:
        async with httpx.AsyncClient() as client:
            # Send the current date in a POST request as a JSON payload
            response = await client.post(url, json={"date": current_date})
            print(f"Status: {response.status_code}")
    except Exception as e:
        print(f"Error: {e}")

# Initialize the AsyncIOScheduler
scheduler = AsyncIOScheduler()

# Cron job to run every minute (or set your interval as needed)
# trigger = CronTrigger(minute='*')  # Every minute for testing
trigger = CronTrigger(hour=3, minute=0)

# Add the job to the scheduler
scheduler.add_job(send_date_to_endpoint, trigger)

@router.on_event("startup")
async def startup_event():
    if not scheduler.running:
        scheduler.start()  # Start the scheduler if it is not already running
        logger.info("Scheduler started and running...")
        logger.info("Current date and time: %s", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    else:
        logger.info("Scheduler was already running.")

@router.post("/trigger-date-sending/")
async def trigger_date_sending(background_tasks: BackgroundTasks):
    background_tasks.add_task(send_date_to_endpoint)
    return {"message": "Date sending job triggered."}

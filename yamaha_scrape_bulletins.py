import os
import sys
import csv
import time
import random
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

# Base URL of the website
BASE_URL = "https://yamahaoutboards.com"
MAIN_PAGE_URL = f"{BASE_URL}/owner-center/performance-bulletins"
API_URL = f"{BASE_URL}/PerformanceBulletin/GetPagedData"

# Headers to bypass Imperva/Incapsula
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

API_HEADERS = {
    **HEADERS,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Referer": MAIN_PAGE_URL,
}

# CSV configuration
CSV_FIELDS = [
    "ypbNumber",
    "boatManufacturer",
    "boatModel",
    "boatTypeCodeName",
    "motorName",
    "motorNumberOfEngines",
    "boatLength",
    "powerMatched",
    "testDate",
    "performanceBulletinPageUrl",
    "pdfUrl",
    "localFilePath",
    "status"
]

csv_lock = threading.Lock()

def get_session():
    """Establish session and cookies by visiting the landing page first."""
    session = requests.Session()
    # Perform retries on the main page to ensure session is initialized
    for attempt in range(3):
        try:
            r = session.get(MAIN_PAGE_URL, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                print("[+] Session initialized successfully.")
                return session
        except Exception as e:
            print(f"[!] Attempt {attempt+1} to initialize session failed: {e}")
            time.sleep(2)
    print("[-] Failed to initialize session.")
    sys.exit(1)

def fetch_all_metadata(session):
    """Fetch metadata for all bulletins using a single large API call."""
    payload = "pageNumber=1&pageSize=1500&paths%5B%5D=%2FOutboards&orderBy=TestDate&orderByDir=desc"
    for attempt in range(3):
        try:
            r = session.post(API_URL, data=payload, headers=API_HEADERS, timeout=20)
            if r.status_code == 200:
                data = r.json()
                bulletins = data.get("data", [])
                print(f"[+] Successfully fetched metadata for {len(bulletins)} bulletins.")
                return bulletins
            else:
                print(f"[!] API call returned status {r.status_code}. Retrying...")
        except Exception as e:
            print(f"[!] API call attempt {attempt+1} failed: {e}")
            time.sleep(3)
    print("[-] Failed to retrieve bulletins metadata.")
    sys.exit(1)

def sanitize_filename(name):
    """Sanitize the string for use as a filename."""
    keepcharacters = (' ', '.', '_', '-')
    sanitized = "".join(c for c in name if c.isalnum() or c in keepcharacters).rstrip()
    return sanitized.replace(" ", "_")

def load_existing_csv(csv_path):
    """Load existing csv file to skip already downloaded bulletins."""
    completed = {}
    if os.path.exists(csv_path):
        with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("ypbNumber"):
                    completed[row["ypbNumber"]] = row
    return completed

def process_bulletin(session, bulletin, download_dir, csv_path, completed_dict):
    ypb_number = bulletin.get("ypbNumber")
    if not ypb_number:
        # Fallback to page url slug
        page_url = bulletin.get("performanceBulletinPageUrl", "")
        if page_url:
            ypb_number = os.path.basename(page_url.rstrip("/")).upper()
            
    if not ypb_number:
        return None
    
    # Clean ypbNumber to match filename
    safe_ypb = sanitize_filename(ypb_number)
    filename = f"{safe_ypb}.pdf"
    local_path = os.path.join(download_dir, filename)
    
    # Check if already completed and file exists
    if ypb_number in completed_dict and os.path.exists(local_path):
        # Already successfully downloaded, skip
        return {
            "ypbNumber": ypb_number,
            "status": "Skipped",
            "msg": f"Skipped (already exists: {filename})"
        }

    # Prepare metadata row
    manu = bulletin.get("boatManufacturer", {})
    manu_name = manu.get("name") if isinstance(manu, dict) else ""
    
    row_data = {
        "ypbNumber": ypb_number,
        "boatManufacturer": manu_name,
        "boatModel": bulletin.get("boatModel", ""),
        "boatTypeCodeName": bulletin.get("boatTypeCodeName", ""),
        "motorName": bulletin.get("motorName", ""),
        "motorNumberOfEngines": bulletin.get("motorNumberOfEngines", ""),
        "boatLength": bulletin.get("boatLength", ""),
        "powerMatched": bulletin.get("powerMatched", ""),
        "testDate": bulletin.get("testDate", ""),
        "performanceBulletinPageUrl": urljoin(BASE_URL, bulletin.get("performanceBulletinPageUrl", "")),
        "pdfUrl": "",
        "localFilePath": local_path,
        "status": "Failed"
    }

    # Visit the landing page to extract PDF URL
    page_url = row_data["performanceBulletinPageUrl"]
    pdf_url = ""
    
    # Add random delay to be polite
    time.sleep(random.uniform(0.5, 1.5))
    
    for attempt in range(3):
        try:
            r = session.get(page_url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "html.parser")
                # Look for 'View PDF Version' link or link containing '/getmedia/'
                pdf_link_el = soup.find("a", string=lambda text: text and "View PDF" in text)
                if not pdf_link_el:
                    # Fallback: find any link containing getmedia
                    for a in soup.find_all("a", href=True):
                        if "/getmedia/" in a["href"] and "Consumer-Dealer-Price-List" not in a["href"]:
                            pdf_link_el = a
                            break
                
                if pdf_link_el:
                    pdf_url = urljoin(BASE_URL, pdf_link_el["href"])
                    row_data["pdfUrl"] = pdf_url
                    break
                else:
                    # Log error if link is not found
                    print(f"[!] View PDF link not found on page: {page_url}")
            else:
                print(f"[!] Landing page return code {r.status_code} for {ypb_number}")
        except Exception as e:
            print(f"[!] Error fetching landing page for {ypb_number} (Attempt {attempt+1}): {e}")
            time.sleep(2)
            
    if not pdf_url:
        print(f"[-] Failed to get PDF URL for {ypb_number}")
        save_metadata(csv_path, row_data)
        return {"ypbNumber": ypb_number, "status": "Failed", "msg": f"Failed (PDF link not found)"}
        
    # Download the PDF file
    for attempt in range(3):
        try:
            r_pdf = session.get(pdf_url, headers=HEADERS, timeout=30, stream=True)
            if r_pdf.status_code == 200:
                with open(local_path, "wb") as f_pdf:
                    for chunk in r_pdf.iter_content(chunk_size=8192):
                        f_pdf.write(chunk)
                
                # Check if it is a valid PDF
                if os.path.exists(local_path) and os.path.getsize(local_path) > 100:
                    row_data["status"] = "Downloaded"
                    save_metadata(csv_path, row_data)
                    print(f"[+] Downloaded: {filename}")
                    return {"ypbNumber": ypb_number, "status": "Downloaded", "msg": f"Downloaded {filename}"}
                else:
                    print(f"[!] Downloaded file for {ypb_number} was empty or too small.")
            else:
                print(f"[!] PDF download return code {r_pdf.status_code} for {ypb_number}")
        except Exception as e:
            print(f"[!] Error downloading PDF for {ypb_number} (Attempt {attempt+1}): {e}")
            time.sleep(2)

    # If it fails to download
    save_metadata(csv_path, row_data)
    return {"ypbNumber": ypb_number, "status": "Failed", "msg": f"Failed (Download error)"}

def save_metadata(csv_path, row_data):
    """Write metadata thread-safely to the CSV file."""
    with csv_lock:
        file_exists = os.path.exists(csv_path)
        # We need to write/update the row.
        # To avoid duplicates in CSV file during multiple runs, we can write as we go.
        # Standard approach: read existing, update, rewrite or just append.
        # Since we are running in parallel, writing as append is simple, but might create duplicate rows
        # if the user runs the script multiple times. However, we loaded completed_dict first to skip downloaded.
        # To be clean, we can just append if it's a new entry, or if it failed.
        # Let's read, update list, and rewrite completely to ensure clean state and no duplicates.
        existing_rows = {}
        if file_exists:
            try:
                with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if row.get("ypbNumber"):
                            existing_rows[row["ypbNumber"]] = row
            except Exception:
                pass
        
        existing_rows[row_data["ypbNumber"]] = row_data
        
        with open(csv_path, mode="w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for key in sorted(existing_rows.keys()):
                writer.writerow(existing_rows[key])

def main():
    parser = argparse.ArgumentParser(description="Yamaha Performance Bulletins PDF Downloader")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of PDFs downloaded (for testing)")
    parser.add_argument("--workers", type=int, default=5, help="Number of concurrent download threads")
    parser.add_argument("--output-dir", type=str, default="yamaha_downloads", help="Directory to save downloaded PDFs")
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    csv_path = os.path.join(args.output_dir, "bulletins_metadata.csv")
    
    print(f"[*] Starting scraper with {args.workers} workers...")
    print(f"[*] Output directory: {args.output_dir}")
    print(f"[*] Metadata CSV path: {csv_path}")

    # Establish session
    session = get_session()

    # Fetch bulletins metadata list
    bulletins = fetch_all_metadata(session)
    if args.limit:
        bulletins = bulletins[:args.limit]
        print(f"[*] Limiting run to first {args.limit} bulletins.")

    # Load existing CSV progress
    completed_dict = load_existing_csv(csv_path)
    print(f"[*] Found {len(completed_dict)} records in existing CSV.")

    # Start scraping thread pool
    downloaded_count = 0
    skipped_count = 0
    failed_count = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                process_bulletin, session, bulletin, args.output_dir, csv_path, completed_dict
            ): bulletin
            for bulletin in bulletins
        }
        
        for future in as_completed(futures):
            res = future.result()
            if res:
                status = res["status"]
                if status == "Downloaded":
                    downloaded_count += 1
                elif status == "Skipped":
                    skipped_count += 1
                else:
                    failed_count += 1
                    print(f"[-] {res['msg']}")

    print("\n" + "="*40)
    print("Scraping Completed!")
    print(f"Total processed: {len(bulletins)}")
    print(f"Downloaded:      {downloaded_count}")
    print(f"Skipped:         {skipped_count}")
    print(f"Failed:          {failed_count}")
    print("="*40)

if __name__ == "__main__":
    main()

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
from urllib.parse import urljoin, unquote

# Base URL of the website
BASE_URL = "https://marine.honda.com"
MAIN_PAGE_URL = f"{BASE_URL}/outboards/performance"

# Headers to mimic a real browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# CSV configuration
CSV_FIELDS = [
    "boat",
    "boatManufacturer",
    "boatModel",
    "boatLength",
    "motorName",
    "motorHP",
    "motorProp",
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

def fetch_all_bulletins(session):
    """Fetch and parse all performance bulletins from the main table."""
    for attempt in range(3):
        try:
            r = session.get(MAIN_PAGE_URL, headers=HEADERS, timeout=20)
            if r.status_code != 200:
                print(f"[!] Page request returned status {r.status_code}. Retrying...")
                time.sleep(2)
                continue
            
            soup = BeautifulSoup(r.text, "html.parser")
            table = soup.find("table")
            if not table:
                print("[-] Could not find the bulletins table on the page.")
                sys.exit(1)
            
            rows = table.find("tbody").find_all("tr") if table.find("tbody") else table.find_all("tr")[1:]
            print(f"[+] Found {len(rows)} rows in the performance table.")
            
            bulletins = []
            for idx, tr in enumerate(rows):
                cells = tr.find_all(["td", "th"])
                if len(cells) < 5:
                    print(f"[!] Skipping row {idx+1} due to insufficient columns ({len(cells)}).")
                    continue
                
                # Get boat column and look for PDF link
                boat_cell = cells[0]
                a_tag = boat_cell.find("a")
                if not a_tag or not a_tag.get("href"):
                    # Row might not have a download link, skip
                    continue
                
                boat_text = boat_cell.get_text(strip=True)
                pdf_url = urljoin(BASE_URL, a_tag["href"])
                
                # Parse manufacturer and model from boat string
                boat_manufacturer = ""
                boat_model = ""
                if " - " in boat_text:
                    parts = boat_text.split(" - ", 1)
                    boat_manufacturer = parts[0].strip()
                    boat_model = parts[1].strip()
                else:
                    # Fallback to space split for first word as manufacturer
                    parts = boat_text.split(" ", 1)
                    if len(parts) == 2:
                        boat_manufacturer = parts[0].strip()
                        boat_model = parts[1].strip()
                    else:
                        boat_manufacturer = boat_text
                
                bulletin = {
                    "boat": boat_text,
                    "boatManufacturer": boat_manufacturer,
                    "boatModel": boat_model,
                    "boatLength": cells[1].get_text(strip=True),
                    "motorName": cells[2].get_text(strip=True),
                    "motorHP": cells[3].get_text(strip=True),
                    "motorProp": cells[4].get_text(strip=True),
                    "pdfUrl": pdf_url
                }
                bulletins.append(bulletin)
                
            print(f"[+] Successfully extracted {len(bulletins)} bulletins with PDF links.")
            return bulletins
            
        except Exception as e:
            print(f"[!] Attempt {attempt+1} to parse page failed: {e}")
            time.sleep(3)
            
    print("[-] Failed to retrieve bulletins.")
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
        try:
            with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row.get("pdfUrl"):
                        completed[row["pdfUrl"]] = row
        except Exception as e:
            print(f"[!] Error loading existing CSV: {e}")
    return completed

def process_bulletin(session, bulletin, download_dir, csv_path, completed_dict):
    pdf_url = bulletin.get("pdfUrl")
    if not pdf_url:
        return None
    
    # Generate filename from PDF URL
    pdf_filename = os.path.basename(unquote(pdf_url))
    safe_filename = sanitize_filename(pdf_filename)
    if not safe_filename.lower().endswith(".pdf"):
        safe_filename += ".pdf"
        
    local_path = os.path.join(download_dir, safe_filename)
    
    # Check if already completed and file exists
    if pdf_url in completed_dict and os.path.exists(local_path):
        return {
            "pdfUrl": pdf_url,
            "status": "Skipped",
            "msg": f"Skipped (already exists: {safe_filename})"
        }

    # Prepare metadata row
    row_data = {
        "boat": bulletin.get("boat", ""),
        "boatManufacturer": bulletin.get("boatManufacturer", ""),
        "boatModel": bulletin.get("boatModel", ""),
        "boatLength": bulletin.get("boatLength", ""),
        "motorName": bulletin.get("motorName", ""),
        "motorHP": bulletin.get("motorHP", ""),
        "motorProp": bulletin.get("motorProp", ""),
        "pdfUrl": pdf_url,
        "localFilePath": local_path,
        "status": "Failed"
    }

    # Add random delay to be polite
    time.sleep(random.uniform(0.5, 1.5))
        
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
                    print(f"[+] Downloaded: {safe_filename}")
                    return {"pdfUrl": pdf_url, "status": "Downloaded", "msg": f"Downloaded {safe_filename}"}
                else:
                    print(f"[!] Downloaded file for {pdf_filename} was empty or too small.")
            else:
                print(f"[!] PDF download return code {r_pdf.status_code} for {pdf_filename}")
        except Exception as e:
            print(f"[!] Error downloading PDF for {pdf_filename} (Attempt {attempt+1}): {e}")
            time.sleep(2)

    # If it fails to download
    save_metadata(csv_path, row_data)
    return {"pdfUrl": pdf_url, "status": "Failed", "msg": f"Failed (Download error)"}

def save_metadata(csv_path, row_data):
    """Write metadata thread-safely to the CSV file."""
    with csv_lock:
        file_exists = os.path.exists(csv_path)
        existing_rows = {}
        if file_exists:
            try:
                with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if row.get("pdfUrl"):
                            existing_rows[row["pdfUrl"]] = row
            except Exception:
                pass
        
        existing_rows[row_data["pdfUrl"]] = row_data
        
        with open(csv_path, mode="w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for key in sorted(existing_rows.keys()):
                writer.writerow(existing_rows[key])

def main():
    parser = argparse.ArgumentParser(description="Honda Performance Bulletins PDF Downloader")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of PDFs downloaded (for testing)")
    parser.add_argument("--workers", type=int, default=5, help="Number of concurrent download threads")
    parser.add_argument("--output-dir", type=str, default="honda_downloads", help="Directory to save downloaded PDFs")
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    csv_path = os.path.join(args.output_dir, "bulletins_metadata.csv")
    
    print(f"[*] Starting Honda scraper with {args.workers} workers...")
    print(f"[*] Output directory: {args.output_dir}")
    print(f"[*] Metadata CSV path: {csv_path}")

    # Establish session
    session = get_session()

    # Fetch bulletins metadata list
    bulletins = fetch_all_bulletins(session)
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

import os
import re
import csv
import json
import pdfplumber
import fitz
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

honda_dir = "honda_downloads"
yamaha_dir = "yamaha_downloads"
output_json_path = "outboards_performance_data.json"

# Fields configuration for mapping metadata
SPEC_MAP = {
    'length': ('boat_specs', 'length'),
    'beam': ('boat_specs', 'beam'),
    'dry weight': ('boat_specs', 'dry_weight'),
    'maximum hp': ('boat_specs', 'max_hp'),
    'max hp': ('boat_specs', 'max_hp'),
    'fuel capacity': ('boat_specs', 'fuel_capacity'),
    'fuel cap': ('boat_specs', 'fuel_capacity'),
    'weight as tested': ('boat_specs', 'weight_as_tested'),
    'horsepower': ('engine_specs', 'horsepower'),
    'induction': ('engine_specs', 'induction'),
    'displacement': ('engine_specs', 'displacement'),
    'weight (estimated)': ('engine_specs', 'weight'),
    'gear ratio': ('engine_specs', 'gear_ratio'),
    'mounting hole': ('engine_specs', 'mounting_hole'),
    'mounting height': ('engine_specs', 'mounting_hole'),
    'ventilation plate': ('engine_specs', 'ventilation_plate_height'),
    'series': ('propeller_specs', 'series'),
    'diameter x pitch': ('propeller_specs', 'diameter_pitch'),
    'diameter/pitch': ('propeller_specs', 'diameter_pitch'),
    'part #': ('propeller_specs', 'part_number'),
    'part number': ('propeller_specs', 'part_number'),
    'propeller material': ('propeller_specs', 'material'),
    'prop material': ('propeller_specs', 'material'),
    'number of people': ('test_conditions', 'number_of_people'),
    'no. of people': ('test_conditions', 'number_of_people'),
    'air / water': ('test_conditions', 'air_water_temp'),
    'air temperature': ('test_conditions', 'air_temp'),
    'wind velocity': ('test_conditions', 'wind_velocity'),
    'elevation': ('test_conditions', 'elevation'),
    'water conditions': ('test_conditions', 'water_conditions'),
    'fuel load': ('test_conditions', 'fuel_load'),
    'test date': ('test_conditions', 'test_date'),
}

TRUNCATE_KEYWORDS = [
    'engine type', 'no. of blades', 'number of blades', 'blades', 'part number', 'part #',
    'material', 'diameter/pitch', 'diameter x pitch', 'displacement', 'control type',
    'operating range', 'prop vent hole', 'acceleration', 'steering', 'jack plate',
    'transom height', 'water conditions', 'fuel load', 'air temperature', 'elevation',
    'wind velocity', 'fuel capacity', 'weight w/o engine', 'max hp', 'length', 'beam',
    'dry weight', 'weight as tested', 'horsepower', 'induction', 'gear ratio', 'mounting hole',
    'mounting height', 'ventilation plate', 'series', 'propeller material', 'prop material',
    'number of people', 'no. of people', 'air / water', 'water conditions', 'test date'
]

def clean_value(val, all_keywords=None):
    if not val:
        return ""
    val = val.strip()
    # Remove leading parenthesized units
    val = re.sub(r'^\([^)]+\)', '', val).strip()
    # Remove leading colons, hyphens, equals
    val = re.sub(r'^[ \t\-\:\=]+', '', val).strip()
    
    if all_keywords:
        for kw in all_keywords:
            pattern = re.compile(r'\b' + re.escape(kw) + r'\b', re.IGNORECASE)
            m = pattern.search(val)
            if m:
                val = val[:m.start()].strip()
                val = re.sub(r'^[ \t\-\:\=]+', '', val).strip()
                val = re.sub(r'[ \t\-\:\=]+$', '', val).strip()
    return val

def parse_float(s):
    if not s:
        return None
    s = s.strip()
    s = re.sub(r'(?i)\s*(mph|gph|mpg|miles|gal|h|rpm|lbs|hp|\°).*', '', s)
    m = re.search(r'[-+]?\d*\.\d+|\d+', s)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None

def is_numeric_value(s):
    if not s:
        return False
    s_clean = s.strip().lower()
    if s_clean in ('-', 'na', 'n/a', 'n.a.', 'n/d'):
        return True
    return parse_float(s) is not None

def parse_rpm(s):
    if not s:
        return None, None
    s_clean = s.strip().lower()
    if 'idle' in s_clean:
        return "Idle", None
    if 'wot' in s_clean:
        m = re.search(r'\d+', s_clean)
        if m:
            val = float(m.group(0))
            if 400 <= val <= 9000:
                return s.strip(), val
        return s.strip(), None
    num = parse_float(s_clean)
    if num is not None:
        if 400 <= num <= 9000:
            return str(int(num)) if num.is_integer() else str(num), num
    return None, None

def clean_and_split_table_rows(table):
    cleaned_rows = []
    for row in table:
        if not row or all(c is None for c in row):
            continue
        max_newlines = 0
        for cell in row:
            if cell and isinstance(cell, str):
                max_newlines = max(max_newlines, cell.count('\n'))
        
        if max_newlines > 0:
            split_cells = []
            for cell in row:
                val = cell if cell is not None else ""
                parts = [p.strip() for p in val.split('\n')]
                while len(parts) < max_newlines + 1:
                    parts.append("")
                split_cells.append(parts)
            for idx in range(max_newlines + 1):
                sub_row = [split_cells[col_idx][idx] for col_idx in range(len(row))]
                cleaned_rows.append(sub_row)
        else:
            cleaned_rows.append([c.strip() if c is not None else "" for c in row])
    return cleaned_rows

def extract_table_performance_data(table):
    rows = clean_and_split_table_rows(table)
    if not rows:
        return None
    
    header_idx = -1
    cols = {}
    for idx, row in enumerate(rows[:3]):
        row_lower = [c.lower() for c in row]
        if 'rpm' in row_lower:
            header_idx = idx
            for c_idx, cell in enumerate(row_lower):
                if 'rpm' in cell:
                    cols['rpm'] = c_idx
                elif 'mph' in cell or 'speed' in cell:
                    cols['mph'] = c_idx
                elif 'gph' in cell or 'flow' in cell or 'fuel' in cell:
                    cols['gph'] = c_idx
                elif 'mpg' in cell or 'econ' in cell or 'eff' in cell:
                    cols['mpg'] = c_idx
                elif 'range' in cell:
                    cols['range'] = c_idx
            break
            
    if header_idx == -1:
        potential_data_rows = 0
        for row in rows:
            if len(row) >= 3:
                first_cell = row[0].lower()
                if ('idle' in first_cell or 'wot' in first_cell or re.match(r'^\d+', first_cell)) and all(is_numeric_value(c) for c in row[1:3]):
                    potential_data_rows += 1
        if potential_data_rows >= 3:
            cols = {'rpm': 0, 'mph': 1, 'gph': 2}
            if len(rows[0]) >= 4:
                cols['mpg'] = 3
            if len(rows[0]) >= 5:
                cols['range'] = 4
            header_idx = 0
            if any(x in rows[0][0].lower() for x in ('rpm', 'speed', 'performance')):
                header_idx = 1
    else:
        header_idx += 1
        
    if 'rpm' not in cols or 'mph' not in cols:
        return None
        
    perf_data = []
    for row in rows[header_idx:]:
        if len(row) <= max(cols.values()):
            continue
        rpm_str = row[cols['rpm']]
        if not rpm_str:
            continue
        rpm_label, rpm_num = parse_rpm(rpm_str)
        if rpm_label is None:
            continue
            
        mph_val = parse_float(row[cols['mph']])
        gph_val = parse_float(row[cols['gph']])
        mpg_val = parse_float(row[cols['mpg']]) if 'mpg' in cols else None
        range_val = parse_float(row[cols['range']]) if 'range' in cols else None
        
        if mph_val is not None or gph_val is not None:
            perf_data.append({
                'rpm': rpm_label,
                'rpm_numeric': rpm_num,
                'mph': mph_val,
                'gph': gph_val,
                'mpg': mpg_val,
                'range': range_val
            })
            
    return perf_data if len(perf_data) >= 3 else None

def extract_text_performance_data(text):
    perf_data = []
    lines = text.split('\n')
    
    # Regex to match RPM rows:
    perf_pattern = re.compile(
        r'\b(Idle|idle|\d{3,5}(?:\.\d+)?)\s+'
        r'(\d+(?:\.\d+)?|\.\d+)\s+'
        r'(\d+(?:\.\d+)?|\.\d+)\s+'
        r'(\d+(?:\.\d+)?|\.\d+)'
        r'(?:\s+(\d+(?:\.\d+)?|\.\d+))?'
    )
    
    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        if not line:
            idx += 1
            continue
            
        m = perf_pattern.search(line)
        if m:
            rpm_str = m.group(1)
            mph_val = parse_float(m.group(2))
            gph_val = parse_float(m.group(3))
            mpg_val = parse_float(m.group(4))
            range_val = parse_float(m.group(5)) if m.group(5) else None
            
            rpm_label, rpm_num = parse_rpm(rpm_str)
            
            if rpm_label is not None:
                perf_data.append({
                    'rpm': rpm_label,
                    'rpm_numeric': rpm_num,
                    'mph': mph_val,
                    'gph': gph_val,
                    'mpg': mpg_val,
                    'range': range_val
                })
        else:
            tokens = line.split()
            if len(tokens) == 1 or (len(tokens) == 2 and tokens[0].lower() in ('wot', 'idle')):
                rpm_label, rpm_num = parse_rpm(line)
                if rpm_label is not None and idx + 1 < len(lines):
                    next_line = lines[idx + 1].strip()
                    float_pattern = re.compile(r'^\s*(\d+(?:\.\d+)?|\.\d+)\s+(\d+(?:\.\d+)?|\.\d+)\s+(\d+(?:\.\d+)?|\.\d+)(?:\s+(\d+(?:\.\d+)?|\.\d+))?')
                    m2 = float_pattern.match(next_line)
                    if m2:
                        mph_val = parse_float(m2.group(1))
                        gph_val = parse_float(m2.group(2))
                        mpg_val = parse_float(m2.group(3))
                        range_val = parse_float(m2.group(4)) if m2.group(4) else None
                        
                        perf_data.append({
                            'rpm': rpm_label,
                            'rpm_numeric': rpm_num,
                            'mph': mph_val,
                            'gph': gph_val,
                            'mpg': mpg_val,
                            'range': range_val
                        })
                        idx += 1
        idx += 1
        
    return perf_data if len(perf_data) >= 3 else None

def parse_pdf(filepath):
    boat_specs = {}
    engine_specs = {}
    propeller_specs = {}
    test_conditions = {}
    performance_data = None
    
    try:
        with pdfplumber.open(filepath) as pdf:
            full_text = ""
            for page in pdf.pages:
                text_content = page.extract_text()
                if text_content:
                    full_text += text_content + "\n"
                
                tables = page.extract_tables()
                for table in tables:
                    p_data = extract_table_performance_data(table)
                    if p_data and not performance_data:
                        performance_data = p_data
                    
                    rows = clean_and_split_table_rows(table)
                    for row in rows:
                        row_cells = [c for c in row if c]
                        if len(row_cells) == 2:
                            key = row_cells[0].strip().lower()
                            val = clean_value(row_cells[1], TRUNCATE_KEYWORDS)
                            for k, (category, field) in SPEC_MAP.items():
                                if k in key:
                                    dest = locals()[category]
                                    if field not in dest or not dest[field]:
                                        dest[field] = val
                                    break
                                    
            if full_text:
                lines = full_text.split('\n')
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    if ':' in line:
                        parts = line.split(':', 1)
                        key = parts[0].strip().lower()
                        val = clean_value(parts[1], TRUNCATE_KEYWORDS)
                        for k, (category, field) in SPEC_MAP.items():
                            if k in key:
                                dest = locals()[category]
                                if field not in dest or not dest[field]:
                                    dest[field] = val
                                break
                    else:
                        for k, (category, field) in SPEC_MAP.items():
                            if line.lower().startswith(k):
                                val = line[len(k):].strip()
                                val = clean_value(val, TRUNCATE_KEYWORDS)
                                dest = locals()[category]
                                if field not in dest or not dest[field]:
                                    dest[field] = val
                                break
                                
            if not performance_data and full_text:
                performance_data = extract_text_performance_data(full_text)
                
    except Exception as e:
        # Silently absorb here, logged by task runner
        pass
        
    return {
        'boat_specs': boat_specs,
        'engine_specs': engine_specs,
        'propeller_specs': propeller_specs,
        'test_conditions': test_conditions,
        'performance_data': performance_data
    }

def get_engine_count(engine_name, motor_count_csv):
    if motor_count_csv:
        csv_val = str(motor_count_csv).strip().lower()
        if csv_val in ("single", "1"):
            return 1
        elif csv_val in ("twin", "2", "21"):
            return 2
        elif csv_val in ("triple", "3"):
            return 3
        elif csv_val in ("quad", "4"):
            return 4
        elif csv_val in ("quint", "5"):
            return 5
        try:
            return int(motor_count_csv)
        except ValueError:
            pass
            
    name = str(engine_name).lower().strip()
    if name.startswith('2 x ') or name.startswith('2x ') or ' twin ' in name or name.startswith('twin '):
        return 2
    if name.startswith('3 x ') or name.startswith('3x ') or ' triple ' in name or name.startswith('triple '):
        return 3
    if name.startswith('4 x ') or name.startswith('4x ') or ' quad ' in name or name.startswith('quad '):
        return 4
    if name.startswith('5 x ') or name.startswith('5x ') or ' quint ' in name or name.startswith('quint '):
        return 5
    return 1

def process_single_item(source, item):
    pdf_url = item.get('pdfUrl', '')
    local_path_raw = item.get('localFilePath', '')
    
    # Locate the PDF file
    resolved_path = None
    if local_path_raw:
        # Standardize path slashes
        norm_path = local_path_raw.replace('\\', '/')
        if os.path.exists(norm_path):
            resolved_path = norm_path
        else:
            filename = os.path.basename(norm_path)
            folder = honda_dir if source == "Honda" else yamaha_dir
            alt_path = os.path.join(folder, filename)
            if os.path.exists(alt_path):
                resolved_path = alt_path
                
    if not resolved_path:
        return None
        
    # Parse PDF contents
    pdf_info = parse_pdf(resolved_path)
    
    # Establish base info from CSV metadata
    boat_type = item.get('boatTypeCodeName', '')
    if not boat_type and source == "Honda":
        mfg = (item.get('boatManufacturer') or '').lower()
        model = (item.get('boatModel') or '').lower()
        boat_type = "Unknown"
        if "pontoon" in model or "avalon" in mfg or "bennington" in mfg:
            boat_type = "PNT"
        elif "aluminum" in model or "hewescraft" in mfg or "starcraft" in mfg:
            boat_type = "ALM"
    elif not boat_type:
        boat_type = "Unknown"

    base_info = {
        'source': source,
        'pdf_filename': os.path.basename(resolved_path),
        'pdf_url': pdf_url,
        'local_file_path': resolved_path,
        'boat_manufacturer': item.get('boatManufacturer', ''),
        'boat_model': item.get('boatModel', ''),
        'boat_length': item.get('boatLength', ''),
        'boat_type': boat_type,
        'engine_name': item.get('motorName', ''),
        'engine_hp': parse_float(item.get('motorHP', '')) if item.get('motorHP') else None,
        'engine_count': get_engine_count(item.get('motorName', ''), item.get('motorNumberOfEngines', '')),
        'propeller_desc': item.get('motorProp', ''),
        'test_date': item.get('testDate', '')
    }
    
    # Merge boat specs
    boat_specs = pdf_info.get('boat_specs', {})
    merged_boat_specs = {
        'length': boat_specs.get('length') or base_info['boat_length'],
        'beam': boat_specs.get('beam') or '',
        'dry_weight': boat_specs.get('dry_weight') or '',
        'max_hp': boat_specs.get('max_hp') or '',
        'fuel_capacity': boat_specs.get('fuel_capacity') or '',
        'weight_as_tested': boat_specs.get('weight_as_tested') or ''
    }
    
    # Merge engine specs
    engine_specs = pdf_info.get('engine_specs', {})
    merged_engine_specs = {
        'horsepower': engine_specs.get('horsepower') or (str(base_info['engine_hp']) if base_info['engine_hp'] else ''),
        'induction': engine_specs.get('induction') or '',
        'displacement': engine_specs.get('displacement') or '',
        'weight': engine_specs.get('weight') or '',
        'gear_ratio': engine_specs.get('gear_ratio') or '',
        'mounting_hole': engine_specs.get('mounting_hole') or '',
        'ventilation_plate_height': engine_specs.get('ventilation_plate_height') or ''
    }
    
    # Merge propeller specs
    propeller_specs = pdf_info.get('propeller_specs', {})
    merged_propeller_specs = {
        'series': propeller_specs.get('series') or '',
        'diameter_pitch': propeller_specs.get('diameter_pitch') or base_info['propeller_desc'],
        'part_number': propeller_specs.get('part_number') or '',
        'material': propeller_specs.get('material') or ''
    }
    
    # Merge test conditions
    test_conditions = pdf_info.get('test_conditions', {})
    merged_test_conditions = {
        'number_of_people': test_conditions.get('number_of_people') or '',
        'air_temp': test_conditions.get('air_temp') or '',
        'water_temp': test_conditions.get('water_temp') or '',
        'elevation': test_conditions.get('elevation') or '',
        'wind_velocity': test_conditions.get('wind_velocity') or '',
        'water_conditions': test_conditions.get('water_conditions') or '',
        'fuel_load': test_conditions.get('fuel_load') or '',
        'test_date': test_conditions.get('test_date') or base_info['test_date']
    }
    
    # Construct final object
    final_record = {
        **base_info,
        'boat_specs': merged_boat_specs,
        'engine_specs': merged_engine_specs,
        'propeller_specs': merged_propeller_specs,
        'test_conditions': merged_test_conditions,
        'performance_data': pdf_info.get('performance_data') or []
    }
    
    return final_record

def main():
    honda_csv = os.path.join(honda_dir, "bulletins_metadata.csv")
    yamaha_csv = os.path.join(yamaha_dir, "bulletins_metadata.csv")
    
    print("[*] Loading CSV metadata files...")
    honda_items = []
    if os.path.exists(honda_csv):
        with open(honda_csv, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            honda_items = [row for row in reader]
            
    yamaha_items = []
    if os.path.exists(yamaha_csv):
        with open(yamaha_csv, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            yamaha_items = [row for row in reader]
            
    print(f"[*] Loaded {len(honda_items)} Honda CSV records and {len(yamaha_items)} Yamaha CSV records.")
    
    tasks = []
    for item in honda_items:
        tasks.append(("Honda", item))
    for item in yamaha_items:
        tasks.append(("Yamaha", item))
        
    print(f"[*] Starting parsing of {len(tasks)} PDF files...")
    
    results = []
    parsed_count = 0
    missing_count = 0
    no_perf_data_count = 0
    
    # Process tasks in parallel using a ThreadPool
    max_workers = 16
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_single_item, src, item): (src, item) for src, item in tasks}
        
        for idx, future in enumerate(as_completed(futures)):
            src, item = futures[future]
            try:
                res = future.result()
                if res is None:
                    missing_count += 1
                else:
                    results.append(res)
                    parsed_count += 1
                    if not res['performance_data']:
                        no_perf_data_count += 1
            except Exception as e:
                print(f"[!] Error processing {src} PDF: {e}")
                
            # Log progress
            if (idx + 1) % 100 == 0 or (idx + 1) == len(tasks):
                print(f"[>] Processed {idx + 1}/{len(tasks)} files...")
                
    # Save output to single JSON file
    print(f"[*] Saving {len(results)} parsed records to {output_json_path}...")
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=4, ensure_ascii=False)
        
    print("\n" + "="*50)
    print("Parsing Completed Successfully!")
    print(f"Total PDFs found & parsed: {parsed_count}")
    print(f"Total PDFs missing:        {missing_count}")
    print(f"PDFs with no RPM tables:   {no_perf_data_count}")
    print(f"Output saved to:           {output_json_path}")
    print("="*50)

if __name__ == "__main__":
    main()

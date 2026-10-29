import os
import json
import datetime
import urllib.request
import xml.etree.ElementTree as ET
from google import genai
from google.genai import types

# 1. Configuration & Dates
TODAY_STR = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
DAILY_DIR = os.path.join("data", "daily")
MANIFEST_PATH = os.path.join("data", "manifest.json")
os.makedirs(DAILY_DIR, exist_ok=True)

# 2. RSS Feeds (India & World)
RSS_FEEDS = {
    "INDIA": "https://news.google.com/rss/headlines/section/topic/NATION.IN?hl=en-IN&gl=IN&ceid=IN:en",
    "WORLD": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en"
}

def fetch_rss_news(feed_url, limit=7):
    """RSS feed se top news titles aur links extract karta hai."""
    news_items = []
    try:
        req = urllib.request.Request(feed_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            tree = ET.fromstring(response.read())
            for item in tree.findall('.//item')[:limit]:
                title = item.find('title').text if item.find('title') is not None else ""
                link = item.find('link').text if item.find('link') is not None else ""
                if title:
                    news_items.append({"title": title, "url": link})
    except Exception as e:
        print(f"Error fetching RSS {feed_url}: {e}")
    return news_items

print(f"Fetching news for {TODAY_STR}...")
india_news = fetch_rss_news(RSS_FEEDS["INDIA"], limit=8)
world_news = fetch_rss_news(RSS_FEEDS["WORLD"], limit=8)

# 3. AI Prompt Preparation
prompt_context = f"""
Aaj ki verified news context:

--- NATIONAL (INDIA) NEWS ---
{json.dumps(india_news, indent=2)}

--- INTERNATIONAL (WORLD) NEWS ---
{json.dumps(world_news, indent=2)}

Instructions:
1. Upar di gayi news ke aadhar par total 10 Multiple Choice Questions (5 for INDIA, 5 for WORLD) tayar karo.
2. UPSC/SSC exam level standard maintain karo.
3. Strictly valid JSON return karo jo is schema ko follow kare:
{{
  "quizDate": "{TODAY_STR}",
  "schemaVersion": "v1.0",
  "totalQuestions": 10,
  "questions": [
    {{
      "id": "CA-{TODAY_STR.replace('-', '')}-01",
      "section": "INDIA ya WORLD",
      "topic": "Economy / Defense / Science / Bilateral / Polity",
      "difficulty": "Medium",
      "question": "Question statement?",
      "options": [
        {{"id": "A", "text": "Option 1"}},
        {{"id": "B", "text": "Option 2"}},
        {{"id": "C", "text": "Option 3"}},
        {{"id": "D", "text": "Option 4"}}
      ],
      "correctOptionId": "A",
      "explanation": "Detailed 2-3 lines explanation.",
      "sourceReference": {{
        "title": "News Headline / Source",
        "url": "Provided article link"
      }}
    }}
  ]
}}
"""

# 4. Gemini API Call
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY secret environment me nahi mila!")

client = genai.Client(api_key=api_key)

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt_context,
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2
    )
)

quiz_data = json.loads(response.text)

# 5. Save Daily JSON
daily_file_path = os.path.join(DAILY_DIR, f"{TODAY_STR}.json")
with open(daily_file_path, "w", encoding="utf-8") as f:
    json.dump(quiz_data, f, indent=2, ensure_ascii=False)
print(f"Quiz successfully saved: {daily_file_path}")

# 6. Update manifest.json
manifest = {"availableDates": []}
if os.path.exists(MANIFEST_PATH):
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception:
        manifest = {"availableDates": []}

if TODAY_STR not in manifest["availableDates"]:
    manifest["availableDates"].insert(0, TODAY_STR)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("manifest.json updated successfully!")
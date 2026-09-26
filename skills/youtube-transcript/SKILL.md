---
name: youtube-transcript
description: "Fetches transcripts/subtitles from YouTube videos and summarizes what the video is about. Use when a user provides a YouTube link (youtube.com, youtu.be) and asks what the video says, what it's about, or for a transcript."
compatibility: "Requires youtube-transcript-api pip package."
---

# YouTube Transcript Fetcher + Summarizer

Fetch a YouTube video's auto-generated captions, read the transcript, and summarize the video's content for the user.

## Workflow

### Step 1: Extract the Video ID

Parse the user's YouTube URL to get the 11-character video ID.

| URL format | Extract |
|---|---|
| `https://youtu.be/VIDEO_ID` | `VIDEO_ID` (after `youtu.be/`, before any `?`) |
| `https://www.youtube.com/watch?v=VIDEO_ID` | `VIDEO_ID` (value of `v` parameter) |
| `https://www.youtube.com/embed/VIDEO_ID` | `VIDEO_ID` (after `/embed/`) |

Strip any trailing query parameters (`?si=...`, `&t=...`, etc.) from the ID.

### Step 2: Ensure the Tool is Installed

Check if `youtube-transcript-api` is available:

```bash
pip list 2>/dev/null | grep youtube-transcript-api
```

If not present, install it:

```bash
pip install --break-system-packages youtube-transcript-api
```

### Step 3: Fetch the Transcript

Run this Python command. Replace `VIDEO_ID` with the extracted ID.

```bash
python3 -c "
from youtube_transcript_api import YouTubeTranscriptApi
transcript = YouTubeTranscriptApi().fetch('VIDEO_ID')
for line in transcript:
    print(line.text)
"
```

**Notes:**

- This fetches English auto-generated captions by default.
- The transcript is printed to stdout — it is not saved to a file.

#### If the fetch fails

Possible errors and how to handle them:

| Error | What to do |
|---|---|
| `No transcripts found` | Check if the video has captions at all. Try listing available languages first: `YouTubeTranscriptApi().list('VIDEO_ID')` and report available languages to the user. |
| `Video unavailable` / `Private video` | Tell the user the video is inaccessible (private, deleted, or region-blocked). |
| `Too Many Requests` | Wait 10 seconds and retry once. If it fails again, inform the user. |

If the transcript is in a different language, mention that to the user and offer to fetch that language instead (use `languages=['lang_code']` parameter).

### Step 4: Read and Summarize

Once the transcript is printed, **read through the full text** and provide a summary covering:

1. **What the video is about** — main topic/thesis
1. **Key points or arguments** the creator makes
1. **Conclusion or call to action** (if any)
1. **Any notable examples or stories** used

### Language Listing (optional)

If the user asks which languages are available, or if English fails:

```python
python3 -c "
from youtube_transcript_api import YouTubeTranscriptApi
langs = YouTubeTranscriptApi().list('VIDEO_ID')
for l in langs:
    print(f'{l.language_code}: {l.language}')
"
```

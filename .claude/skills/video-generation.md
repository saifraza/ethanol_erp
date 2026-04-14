# Video Generation — Google Veo via Gemini API

## Overview
Generate factory/plant videos using Google's Veo models via the Gemini API. Used for MSPIL promotional content, factory documentation, and plant operations videos.

## API Key
- **Gemini API Key**: stored in memory (`reference_gemini_key.md`)
- Set as env var: `export GEMINI_API_KEY="<key>"`
- Or pass inline to client: `client = genai.Client(api_key="<key>")`

## Setup
```bash
pip install google-genai
```

## Quick Generate (copy-paste)
```python
import time
from google import genai
from google.genai import types

client = genai.Client(api_key="YOUR_KEY_HERE")

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Aerial view of an ethanol distillery plant with tall columns, storage tanks, and corn unloading area in rural India",
    config=types.GenerateVideosConfig(
        aspect_ratio="16:9",
        resolution="1080p",
        duration_seconds="8",
        person_generation="allow_all",
        number_of_videos=1,
    ),
)

# Poll until done
while not operation.done:
    print("Generating video...")
    time.sleep(10)
    operation = client.operations.get(operation)

# Save
video = operation.response.generated_videos[0]
client.files.download(file=video.video)
video.video.save("output.mp4")
print("Saved: output.mp4")
```

## Available Models (best to cheapest)

| Model | ID | Quality | Speed |
|-------|-----|---------|-------|
| **Veo 3.1** | `veo-3.1-generate-preview` | Best, 8K cinema-grade | Slow |
| **Veo 3.1 Fast** | `veo-3.1-generate-preview` (with fast config) | Great | Medium |
| **Veo 3.1 Lite** | `veo-3.1-lite-generate-preview` | Good, low cost | Fast |
| **Veo 3** | `veo-3-generate-preview` | Great + native audio | Slow |
| **Veo 2** | `veo-2-generate-preview` | Good | Medium |

**Recommendation**: 
- **People/lifestyle videos**: Use `veo-2.0-generate-001` — Veo 3.x has strict safety filters that reject most person-generation prompts
- **Non-people (factory, product, scenery)**: Use `veo-3.1-generate-preview` for best quality
- **Quick drafts**: Use `veo-3.1-lite-generate-preview`

## Config Options

```python
types.GenerateVideosConfig(
    aspect_ratio="16:9",         # "16:9" (landscape) or "9:16" (portrait)
    resolution="1080p",          # "720p", "1080p", "4k"
    duration_seconds="8",        # "4", "6", "8"
    person_generation="allow_all",
    number_of_videos=1,          # How many variants to generate
    negative_prompt="blurry, low quality",  # What to avoid
    # last_frame=image,          # For video extension
    # reference_images=[img1],   # Up to 3 reference images for style guidance
)
```

## MSPIL Factory Prompts (tested, good results)

### Ethanol Plant Overview
```
Aerial cinematic shot of an industrial ethanol distillery plant in rural central India. 
Tall stainless steel distillation columns, storage tanks, pipe racks, cooling towers. 
Green fields surrounding the factory. Golden hour lighting. Professional industrial documentary style.
```

### Corn Unloading
```
Close-up shot of yellow corn grain being unloaded from a truck at an industrial weighbridge. 
Grain pouring into a hopper pit. Dust particles visible in sunlight. 
Industrial factory setting in India. Documentary style.
```

### Tips for Good Factory Videos
- Include "industrial", "documentary style", "cinematic" for professional look
- Mention "India" or "rural central India" for correct architecture style
- Use negative prompt: "cartoon, anime, unrealistic, blurry, low quality"
- 16:9 landscape for factory overview, 9:16 portrait for social media
- 8 seconds is the sweet spot for factory clips

## Running as a Script

Save as `generate_video.py` and run:
```bash
GEMINI_API_KEY="your-key" python generate_video.py
```

Or interactively in Claude Code:
```bash
python3 -c "
import time
from google import genai
from google.genai import types

client = genai.Client(api_key='YOUR_KEY')
op = client.models.generate_videos(
    model='veo-3.1-generate-preview',
    prompt='YOUR PROMPT HERE',
)
while not op.done:
    time.sleep(10)
    op = client.operations.get(op)
v = op.response.generated_videos[0]
client.files.download(file=v.video)
v.video.save('output.mp4')
print('Done!')
"
```

## References
- [Veo API Docs](https://ai.google.dev/gemini-api/docs/video)
- [Gemini API Quickstart](https://ai.google.dev/gemini-api/docs/quickstart)
- [Veo 3.1 Blog Post](https://developers.googleblog.com/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)

## Overview
Transforms audio to the frequency domain (STFT), filters unwanted components, then reconstructs audio via inverse STFT. 

## Repo layout
- `Audios/` (sample input audio)
- `Filtering Techniques/` (core filtering work)
- `Demo Audio Analysis/` (analysis)
- `README.md`

## Getting started
1. Create a Python env.
2. Install DSP dependencies (NumPy, SciPy, Librosa, Matplotlib).
3. Record audio file and place in directory (file type must be compatible with Librosa) 
4. Run desired script in `Filtering Techniques/` and review outputs in `Demo Audio Analysis/`.

Notes: 
- If the audio file is not found, adjust the script's input file pathway.
- Ensure the script's output file pathway is as intended.

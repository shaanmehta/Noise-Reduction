## Overview
Transforms audio to the frequency domain (STFT), filters unwanted components, then reconstructs audio via inverse STFT. 

## Repo layout
- `Audios/` (sample input audio)
- `Filtering Techniques/` (core filtering work)
- `Demo Audio Analysis/` (analysis)
- `README.md`

## Getting started
1. Clone the repository (git clone https://github.com/shaanmehta/Noise-Reduction.git)
2. Create a Python env.
3. Install DSP dependencies (NumPy, SciPy, Librosa, Matplotlib).
4. Record audio file and place in directory (file type must be compatible with Librosa) 
5. Run desired script in `Filtering Techniques/` and review outputs in `Demo Audio Analysis/`.

Notes: 
- If the audio file is not found, adjust the script's input file pathway.
- Ensure the script's output file pathway is as intended.

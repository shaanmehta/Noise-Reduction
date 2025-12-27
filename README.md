# NoiseReduction
Noise Reduction Techniques For Digital Audio Samples

This project seeks to investigate how noise reduction is implemented 
by using Fourier theory. The programs use the Discrete Fourier Transform 
to filter out the unwanted frequencies of a digital audio sample. 

The Short-time Fourier Transform (STFT) applies the DFT to short fragments of time in a signal. It is a 
powerful technique for analyzing a signal with varying frequency components. In the computer program, 
the STFT will be used to transform the audio signal from the time domain to the frequency domain. Then, 
an inverse STFT will be used to convert a filtered frequency back to the time domain. The new audio in 
the time domain will be the cleaned version with noise reduction.

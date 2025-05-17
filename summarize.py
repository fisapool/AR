import sys
from transformers import pipeline

summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
text = sys.stdin.read()
summary = summarizer(text, max_length=60, min_length=20, do_sample=False)
print(summary[0]['summary_text']) 
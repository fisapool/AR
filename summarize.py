import sys
from transformers import pipeline

summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
# Upgrade to an even larger model for subtopic generation
text_generator = pipeline("text-generation", model="distilgpt2")

def get_subtopics(question):
    prompt = f"Given the research question: '{question}', list 5-7 key subtopics or aspects that should be covered to answer it comprehensively. Only return the subtopics, one per line."
    # Generate text (subtopics)
    result = text_generator(prompt, max_length=100, num_return_sequences=1)[0]['generated_text']
    # Extract subtopics (split by lines, filter empty)
    subtopics = [line.strip('- ').strip() for line in result.split('\n') if line.strip() and not line.lower().startswith('given the research question')]
    # Return only 5-7 subtopics
    return subtopics[:7]

if __name__ == "__main__":
    text = sys.stdin.read()
    summary = summarizer(text, max_length=60, min_length=20, do_sample=False)
    print(summary[0]['summary_text']) 
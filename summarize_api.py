from flask import Flask, request, jsonify
from transformers import pipeline
import re

app = Flask(__name__)
summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
qa_pipeline = pipeline("question-answering")

def clean_text(text):
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Replace multiple spaces/newlines with a single space
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.json
    text = data.get('text', '')
    text = clean_text(text)
    if not text or len(text) < 10:
        return jsonify({'summary': 'Input too short for summarization.'}), 400
    # Limit input length to 1024 characters
    max_input_length = 1024
    if len(text) > max_input_length:
        text = text[:max_input_length]
    try:
        summary = summarizer(text, max_length=60, min_length=20, do_sample=False)
        return jsonify({'summary': summary[0]['summary_text']})
    except Exception as e:
        return jsonify({'summary': f'Error during summarization: {str(e)}'}), 500

@app.route('/qa', methods=['POST'])
def qa():
    data = request.json
    context = data['context']
    question = data['question']
    answer = qa_pipeline({'context': context, 'question': question})
    return jsonify({'answer': answer['answer']})

if __name__ == '__main__':
    app.run(port=5000) 
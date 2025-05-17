from flask import Flask, request, jsonify
from flask_cors import CORS
import re

try:
    from transformers import pipeline
    import summarize
    print("Imports successful")
except Exception as e:
    print("Error during import/setup:", e)
    raise

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

try:
    summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
    qa_pipeline = pipeline("question-answering")
    print("Pipelines loaded")
except Exception as e:
    print("Error loading pipelines:", e)
    raise

def clean_text(text):
    # Remove HTML tags and excessive whitespace
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

@app.route('/summarize', methods=['POST'])
def summarize_route():
    data = request.get_json(force=True)
    text = clean_text(data.get('text', ''))
    if not text or len(text) < 10:
        return jsonify({'summary': 'Input too short for summarization.'}), 400
    max_input_length = 1024
    if len(text) > max_input_length:
        text = text[:max_input_length]
    try:
        summary = summarizer(text, max_length=60, min_length=20, do_sample=False)
        return jsonify({'summary': summary[0]['summary_text']})
    except Exception as e:
        print("Error during summarization:", e)
        return jsonify({'summary': f'Error during summarization: {str(e)}'}), 500

@app.route('/qa', methods=['POST'])
def qa():
    data = request.get_json(force=True)
    context = data.get('context', '')
    question = data.get('question', '')
    if not context or not question:
        return jsonify({'error': 'Both context and question are required.'}), 400
    try:
        answer = qa_pipeline({'context': context, 'question': question})
        return jsonify({'answer': answer['answer']})
    except Exception as e:
        print("Error during QA:", e)
        return jsonify({'answer': f'Error during QA: {str(e)}'}), 500

@app.route('/subtopics', methods=['POST'])
def subtopics():
    data = request.get_json(force=True)
    question = data.get('question', '')
    if not question or len(question) < 5:
        return jsonify({'subtopics': []}), 400
    try:
        subtopics = summarize.get_subtopics(question)
        return jsonify({'subtopics': subtopics})
    except Exception as e:
        print("Error during subtopics extraction:", e)
        return jsonify({'subtopics': [], 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000) 
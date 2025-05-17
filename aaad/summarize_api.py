from flask import Flask, request, jsonify
import requests
import re

app = Flask(__name__)

def ollama_generate(prompt, model="mistral"):
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={"model": model, "prompt": prompt, "stream": False}
    )
    return response.json()["response"]

def clean_text(text):
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Replace multiple spaces/newlines with a single space
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.json
    prompt = data.get('text', '')
    prompt = clean_text(prompt)
    if not prompt or len(prompt) < 10:
        return jsonify({'summary': 'Input too short for summarization.'}), 400
    try:
        # Use 'mistral' or 'llama3' as the model name
        summary = ollama_generate(prompt, model="mistral")
        return jsonify({'summary': summary})
    except Exception as e:
        return jsonify({'summary': f'Error during generation: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(port=5000)

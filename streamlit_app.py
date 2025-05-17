import streamlit as st
import requests

st.title("Research Assistant Dashboard")

st.write("Enter a research question to get subtopics and a summary report.")

question = st.text_input("Research Question:")
summarizer = st.radio("Choose summarizer:", ["Gemini", "Local Python"], index=1)

if st.button("Submit Question") and question:
    with st.spinner("Processing..."):
        # Call your Flask API (adjust port if needed)
        response = requests.post("http://localhost:3000/ask", json={"question": question, "summarizer": summarizer})
        if response.status_code == 200:
            result = response.json()
            st.subheader("Subtopics")
            for i, sub in enumerate(result.get("log", [])):
                st.markdown(f"**{i+1}. {sub['subtopic']}**")
                st.markdown(f"Summary: {sub['summary']}")
            st.subheader("Final Report")
            st.markdown(result.get("report", "No report generated."))
            # Feedback form
            st.subheader("Feedback")
            feedback = st.text_area("Your feedback on the report:")
            if st.button("Submit Feedback"):
                # Optionally send feedback to backend
                st.success("Thank you for your feedback!")
        else:
            st.error("Error from backend: " + response.text) 
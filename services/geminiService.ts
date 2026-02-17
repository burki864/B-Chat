
import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.API_KEY;
    if (apiKey && apiKey !== 'undefined') {
      try {
        this.ai = new GoogleGenAI({ apiKey });
      } catch (e) {
        console.error("Gemini init failed:", e);
      }
    }
  }

  async generateReply(chatHistory: { sender: string; text: string }[], botName: string) {
    if (!this.ai) return "AI is not configured (missing API Key).";

    const prompt = `
      You are participating in a group chat as ${botName}. 
      Context of the conversation:
      ${chatHistory.map(m => `${m.sender}: ${m.text}`).join('\n')}
      
      Respond naturally, concisely, and stay in character as a helpful colleague.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      return response.text || "I'm not sure how to respond to that.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Thinking... (API error)";
    }
  }
}

export const gemini = new GeminiService();

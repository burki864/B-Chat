
import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async generateReply(chatHistory: { sender: string; text: string }[], botName: string) {
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

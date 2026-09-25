// The only file that knows which LLM provider we use (Gemini for now). Swap here for Claude later.
import { GoogleGenAI } from '@google/genai'

export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001'
export const EMBED_DIM = 768 // must match the check on chunks.embedding in db/0001_rag.sql

let client: GoogleGenAI | undefined
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }))

// One structured call: the model must answer with JSON matching `schema` (plain JSON Schema).
export async function generateJson<T>(system: string, prompt: string, schema: object): Promise<T> {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema },
  })
  if (!res.text) throw new Error(`${MODEL} returned no text (finish: ${res.candidates?.[0]?.finishReason})`)
  return JSON.parse(res.text) as T
}

export async function embed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) { // API caps a request at 100 inputs
    const res = await ai().models.embedContent({
      model: EMBED_MODEL,
      contents: texts.slice(i, i + 100),
      config: { taskType, outputDimensionality: EMBED_DIM },
    })
    out.push(...res.embeddings!.map(e => e.values!))
  }
  return out
}

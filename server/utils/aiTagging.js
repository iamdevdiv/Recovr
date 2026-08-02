import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function autoTagColumnsWithAI(columns, availableTags, sampleData = {}) {
  if (!columns || columns.length === 0) return {};

  const systemPrompt = `You are an expert data mapping assistant for a loan collection agency. Your job is to map raw spreadsheet column names to a standardized set of tags.
Available standard tags:
${availableTags.map(t => `- ${t}`).join('\n')}

For each raw column name provided by the user, return a JSON object where the key is the raw column name and the value is the EXACT matching standard tag from the list above.
Use your best judgment based on contextual similarities (e.g., "agreementno" -> "Loan No", "nomineemobile" -> "Reference mobile", "principaloutstanding" -> "POS", "emiamt" -> "EMI Amount").
The user will provide a JSON object containing "columns" (the list of column names) and "sampleRowData" (one row of data to help you understand the format of each column).
If there is no logical match for a column, the value MUST be null.

CRITICAL RULES:
1. Each standard tag MUST be assigned to AT MOST ONE raw column (find the single most appropriate match).
2. EXCEPTION: The standard tags 'Reference name' and 'Reference mobile' CAN be assigned to multiple raw columns if multiple references exist.
3. For all other tags, NEVER assign them to more than one raw column.
4. The 'Vehicle' tag MUST map to the vehicle name or model ONLY, never to the vehicle number, registration number, or license plate.

ONLY output raw JSON. Do not use markdown code blocks like \`\`\`json. Output format example:
{"agreementno": "Loan No", "random_col": null}`;

  const userMessage = JSON.stringify({
    columns,
    sampleRowData: sampleData
  });

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      response_format: { type: 'json_object' }
    });

    const content = chatCompletion.choices[0]?.message?.content;
    if (content) {
      // Strip markdown code blocks just in case the model returns them despite instructions
      const cleanContent = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(cleanContent);
    }
    return {};
  } catch (error) {
    console.error('[AI Tagging Error]', error.message || error);
    return {};
  }
}

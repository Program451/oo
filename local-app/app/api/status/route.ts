import {env} from "cloudflare:workers";
import {getChatGPTUser} from "@/app/chatgpt-auth";
export async function GET(){const user=await getChatGPTUser();return Response.json({signedIn:!!user,geminiConfigured:!!env.GEMINI_API_KEY,dailyLimit:8});}

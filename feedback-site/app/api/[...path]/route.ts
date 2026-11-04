import {env} from 'cloudflare:workers';
import {handleFeedback} from '@/lib/feedback-service';
export const dynamic='force-dynamic';
export function GET(req:Request){return handleFeedback(req,env);}
export function POST(req:Request){return handleFeedback(req,env);}
export function PATCH(req:Request){return handleFeedback(req,env);}

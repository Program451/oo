import {env} from "cloudflare:workers";
import {getChatGPTUser} from "@/app/chatgpt-auth";
import type {DataSet,Meal,Review,Experiment} from "./domain";
export async function identity(){const u=await getChatGPTUser();if(!u)throw new Error("AUTH");return u.userId;}
export function database(){if(!env.DB)throw new Error("DB_UNAVAILABLE");return env.DB;}
export async function loadData(owner:string):Promise<DataSet>{const {results}=await database().prepare("SELECT id,kind,body FROM entries WHERE owner=? ORDER BY created_at DESC LIMIT 5000").bind(owner).all<{id:string;kind:string;body:string}>();const data:DataSet={meals:[],reviews:[],experiments:[]};for(const row of results){const item={...JSON.parse(row.body),id:row.id};if(row.kind==="meal")data.meals.push(item as Meal);if(row.kind==="review")data.reviews.push(item as Review);if(row.kind==="experiment")data.experiments.push(item as Experiment);}return data;}
export function apiError(e:unknown){if(e instanceof Error&&e.message==="AUTH")return Response.json({error:"Войдите, чтобы сохранять данные и использовать Gemini."},{status:401});return Response.json({error:"Не удалось выполнить операцию. Попробуйте ещё раз."},{status:500});}
export async function readBody(req:Request){if(Number(req.headers.get("content-length")||0)>20000)throw new Error("BODY");const t=await req.text();if(t.length>20000)throw new Error("BODY");return JSON.parse(t);}
export function sameOrigin(req:Request){const o=req.headers.get("origin");return !o||o===new URL(req.url).origin;}

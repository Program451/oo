let input="";
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
console.log("Ready for secret on stdin (input hidden).");
process.stdin.on("data",async chunk=>{input+=chunk;if(!/[\r\n]/.test(input))return;process.stdin.pause();try{const key=input.trim();input="";const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",{headers:{"x-goog-api-key":key},signal:AbortSignal.timeout(20000)});const result=await response.json();console.log(JSON.stringify({status:response.status,models:result.models?.filter(m=>m.name.includes("flash")&&m.supportedGenerationMethods?.includes("generateContent")).map(m=>m.name),error:result.error?{status:result.error.status,message:String(result.error.message).replaceAll(key,"[REDACTED]")}:undefined}));process.exit(response.ok?0:1);}catch(e){console.log(JSON.stringify({error:e.message,cause:e.cause?.code}));process.exit(1);}});

process.stdin.resume();

try{
 const r=await fetch('http://127.0.0.1:5174/api/shutdown',{method:'POST',headers:{Origin:'http://127.0.0.1:5174','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new Error(`HTTP ${r.status}`);
 console.log('Asyl As and the local model stopped.');
}catch(error){console.log('Local application is not running, or could not be stopped:',error.message);process.exitCode=1;}

/** Bounded transient SSE transport. Durable cursor/replay feeds are separate. */
export function eventStream<T>(request: Request, options: {
  subscribe: (listener: (event: T) => void) => () => void;
  project: (event: T) => Promise<{ id: string; [key: string]: unknown } | null>;
  validate: () => Promise<boolean>;
}) {
  const encoder = new TextEncoder(); let cleanup: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false; let unsubscribe = () => {}; let timer: ReturnType<typeof setInterval> | undefined;
      let pending = 0; let queue = Promise.resolve();
      const close = () => { if (closed) return; closed=true; if(timer)clearInterval(timer); unsubscribe(); request.signal.removeEventListener('abort',close); try{controller.close()}catch{/* Already cancelled. */} };
      cleanup=close;
      // No controller.error path exists; cancellation sets closed before sends.
      const send=(chunk:string)=>{if(closed)return;if(controller.desiredSize!<=0){close();return}controller.enqueue(encoder.encode(chunk))};
      const enqueue=(work:()=>Promise<void>)=>{if(closed)return;if(++pending>100){close();return}queue=queue.then(async()=>{try{if(!closed)await work()}finally{pending--}}).catch(close)};
      request.signal.addEventListener('abort',close,{once:true});
      if(request.signal.aborted){close();return}
      send('retry: 3000\n\n');send(`data: ${JSON.stringify({data:{id:`connected-${Date.now()}`,type:'stream.connected',occurredAt:new Date().toISOString()},meta:{}})}\n\n`);
      try {
        unsubscribe=options.subscribe(event=>enqueue(async()=>{
          if(!await options.validate()){close();return}
          const data=await options.project(event);if(data&&!closed)send(`id: ${data.id.replace(/[\r\n]/g,'')}\ndata: ${JSON.stringify({data,meta:{}})}\n\n`);
        }));
        if(closed){unsubscribe();return}
        timer=setInterval(()=>enqueue(async()=>{if(!await options.validate()){close();return}send(`: ping ${new Date().toISOString()}\n\n`)}),15000);
      }catch{close()}
    },
    cancel(){cleanup()},
  },{highWaterMark:1024*1024,size:chunk=>chunk.byteLength});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'}});
}

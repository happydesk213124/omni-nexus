export type ReferenceProgress = {id:string;scope:string;kind:'preset'|'character';busy:boolean;url?:string;error?:string};
const states=new Map<string,ReferenceProgress>();
const listeners=new Set<()=>void>();
export function referenceProgress(){return [...states.values()];}
export function publishReferenceProgress(state:ReferenceProgress){states.set(state.kind+':'+state.scope+':'+state.id,state);for(const fn of listeners)fn();}
export function subscribeReferenceProgress(fn:()=>void){listeners.add(fn);return ()=>listeners.delete(fn);}

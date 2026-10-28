/** A board link selects a view only; it never carries a write intent. */
export function planningBoardRoute(route:string):{id:string;view:'board'|'assembly'|'decisions'}|null {
 if(/[\s\\\u0000-\u001f\u007f]/.test(route))return null;
 const match=/^#planning\/boards\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\/(assembly|decisions))?$/.exec(route);
 return match?{id:match[1].toLowerCase(),view:(match[2]||'board') as 'board'|'assembly'|'decisions'}:null;
}

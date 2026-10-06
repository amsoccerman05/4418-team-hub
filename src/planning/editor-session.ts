export type EditorSession = {route:string;edit:object|null};
// Object identity distinguishes reopening the same task from the earlier editor.
// Reading the actual hash also covers navigation before React's next render.
export function isCurrentEditor(expected:EditorSession,current:EditorSession,actualRoute:string,mounted=true):boolean {
 return mounted&&expected.edit!==null&&expected.edit===current.edit&&expected.route===current.route&&expected.route===actualRoute;
}

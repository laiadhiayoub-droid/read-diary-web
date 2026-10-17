import { useId } from "react";
import type { NotebookDiagram as Diagram } from "@/lib/notebook-diagram";

/** Render only whitelisted SVG primitives. Source colors are document data, not UI theme colors. */
export function NotebookDiagram({ diagram }: { diagram: Diagram }) {
  const titleId = useId();
  return <figure className="notebook-diagram" dir="ltr">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${diagram.width} ${diagram.height}`}
      role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
      <title id={titleId}>{diagram.description}</title>
      {diagram.elements.map((element, index) => {
        switch (element.kind) {
          case "line": case "arrow": {
            const angle = Math.atan2(element.y2 - element.y, element.x2 - element.x);
            const size = Math.max(8, element.strokeWidth * 4);
            const head = `${element.x2},${element.y2} ${element.x2-size*Math.cos(angle-0.45)},${element.y2-size*Math.sin(angle-0.45)} ${element.x2-size*Math.cos(angle+0.45)},${element.y2-size*Math.sin(angle+0.45)}`;
            return <g key={index} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round">
              <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2}/>
              {element.kind === "arrow" && <polygon points={head} fill={element.stroke} stroke="none"/>}
            </g>;
          }
          case "rect": return <rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} rx={element.radius} stroke={element.stroke} fill={element.fill ?? "none"} strokeWidth={element.strokeWidth}/>;
          case "ellipse": return <ellipse key={index} cx={element.x} cy={element.y} rx={element.rx} ry={element.ry} stroke={element.stroke} fill={element.fill ?? "none"} strokeWidth={element.strokeWidth}/>;
          case "path": return <path key={index} d={element.d} stroke={element.stroke} fill={element.fill ?? "none"} strokeWidth={element.strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>;
          case "label": return <text key={index} x={element.x} y={element.y} fill={element.color} fontSize={element.fontSize} textAnchor="middle" dominantBaseline="middle" direction={element.direction} unicodeBidi="plaintext">{element.text}</text>;
          case "charge": return <g key={index} className={`diagram-charge diagram-charge-${element.sign === "+" ? "positive" : "negative"}`}>
            <circle cx={element.x} cy={element.y} r={element.radius}/>
            <text x={element.x} y={element.y} fontSize={element.radius*1.5} textAnchor="middle" dominantBaseline="central">{element.sign === "+" ? "+" : "−"}</text>
          </g>;
        }
      })}
    </svg>
  </figure>;
}
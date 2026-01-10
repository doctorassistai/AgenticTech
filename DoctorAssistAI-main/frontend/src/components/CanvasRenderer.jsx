import React from "react";
import ProfileHeader from "./ProfileHeader";
import KeyValueTable from "./GlassTable";
import SectionCard from "./SectionCard";
import { ToggleCard } from "./ToggleCard";
import ReusableChartCard from "./ReusableChartCard";
import Notification from "./Notification";
export default function CanvasRenderer({ components }) {
    console.log("CanvasRenderer received components:", components);
  if (!components || components.length === 0) return null;
      
 return (
  <div className="canvas-root">
    {components.map((component, index) => {

        const title = component.title || component.node_name || `Component ${index}`;
         const mode = component.display_mode || component.type;
        switch (mode) {
          case "profile":
            return (
             
                <ProfileHeader key={index} title={title} data={component.data} />
               
              
            );

          case "table":
            return (
              
                <KeyValueTable key={index}  data={component.data} />
              
            );

          case "chart":
            return (
              <ReusableChartCard
                key={index}
              
                data={component.data}
                lines={component.lines || []} // pass lines info dynamically
              />
            );

          case "text":
            return (
              <SectionCard key={index} 
               data={component.data} />
              
            );

          case "analysis":
            return (
              <ToggleCard key={index} >
                <SectionedTables data={component.data} />
              </ToggleCard>
            );
  case "notification":   // 🆕 added
    return (
      <Notification
        key={index}
        title={title}
        data={component.data}
      />
    );
          default:
            return null;
        }
      })}
    </div>
  );
}

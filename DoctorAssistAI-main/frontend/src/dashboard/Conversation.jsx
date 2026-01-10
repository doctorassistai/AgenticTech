import { useEffect } from 'react';
import backgroundImage from '../assets/freepik__the-style-is-candid-image-photography-with-natural__23082.jpeg';

const VoiceAgentPage = () => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${backgroundImage})`,
        }}
      />

      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <elevenlabs-convai agent-id="agent_0401keech154ehmvdhp8xp51kc7a"></elevenlabs-convai>

          <div className="absolute bottom-[-1rem] right-5 bg-gradient-to-r from-white to-gray-400 text-black w-62 h-6 flex items-center justify-center rounded z-9999 text-sm">
            <span>Powered by DoctorAssist.AI</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceAgentPage;

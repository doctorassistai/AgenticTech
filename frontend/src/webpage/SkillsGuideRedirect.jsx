import { useEffect } from 'react';

const SkillsGuideRedirect = () => {
  useEffect(() => {
    window.location.href = '/clinical-agent-skills-guide.html';
  }, []);
  
  return null;
};

export default SkillsGuideRedirect;
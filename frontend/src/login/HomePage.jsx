import { useEffect } from "react";

const HomePage = () => {
  useEffect(() => {
    window.location.href = "/index.html";
  }, []);

  return null; // or a loading message
};

export default HomePage;

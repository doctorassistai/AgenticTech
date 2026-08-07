import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";


const API_PREFIX =
  "https://doctorassist.ai/api/hms/users/speciality";


export default function PatientRAGTest() {


  const [searchParams] = useSearchParams();


  const doctorId =
    searchParams.get("doctor_id");


  const patientId =
    searchParams.get("patient_id");



  const [question, setQuestion] = useState("");

  const [buildStatus, setBuildStatus] = useState("");

  const [answer, setAnswer] = useState("");

  const [loading, setLoading] = useState(false);



  const buildPatientRAG = async () => {


    if (!doctorId || !patientId) {

      setBuildStatus(
        "Doctor ID or Patient ID missing in URL"
      );

      return;
    }


    try {


      setBuildStatus(
        "Building patient RAG..."
      );



      const response = await fetch(

        `${API_PREFIX}/patient-rag/build/${doctorId}/${patientId}`,

        {
          method:"POST",

          headers:{
            "Content-Type":"application/json"
          }
        }

      );



      const data =
        await response.json();



      console.log(
        "Build Response:",
        data
      );



      setBuildStatus(
        JSON.stringify(
          data,
          null,
          2
        )
      );



    } catch(error) {


      console.error(error);


      setBuildStatus(
        "Error: " + error.message
      );

    }

  };





  const searchPatientRAG = async () => {



    if (!doctorId || !patientId) {

      setAnswer(
        "Doctor ID or Patient ID missing in URL"
      );

      return;

    }



    if (!question.trim()) {

      setAnswer(
        "Please enter a question"
      );

      return;

    }



    try {


      setLoading(true);


      setAnswer(
        "Searching..."
      );



      const response = await fetch(

        `${API_PREFIX}/patient-rag/search`,

        {

          method:"POST",

          headers:{

            "Content-Type":
            "application/json"

          },


          body:JSON.stringify({

            doctor_id:doctorId,

            patient_id:patientId,

            question:question,

            top_k:5

          })

        }

      );



      const data =
        await response.json();



      console.log(
        "Search Response:",
        data
      );



      setAnswer(

        data.answer ||

        JSON.stringify(
          data,
          null,
          2
        )

      );



    } catch(error) {


      console.error(error);



      setAnswer(
        "Error: " + error.message
      );


    } finally {


      setLoading(false);

    }


  };





  return (

    <div

      style={{

        padding:"30px",

        maxWidth:"900px",

        margin:"auto",

        fontFamily:"Arial"

      }}

    >



      <h2>
        Patient RAG Assistant
      </h2>



      <div

        style={{

          background:"#f5f5f5",

          padding:"20px",

          borderRadius:"10px"

        }}

      >



        <h4>
          Patient Context
        </h4>


        <p>
          <b>Doctor ID:</b> {doctorId || "Missing"}
        </p>


        <p>
          <b>Patient ID:</b> {patientId || "Missing"}
        </p>




        <button

          onClick={buildPatientRAG}

          style={buttonStyle}

        >

          Build Patient RAG

        </button>



        <pre

          style={{

            background:"#fff",

            padding:"10px",

            marginTop:"15px",

            whiteSpace:"pre-wrap"

          }}

        >

          {buildStatus}

        </pre>



      </div>





      <hr

        style={{

          margin:"30px 0"

        }}

      />





      <h3>
        Ask Patient Question
      </h3>




      <textarea


        value={question}


        onChange={
          e =>
          setQuestion(
            e.target.value
          )
        }


        placeholder=
        "Example: What was the biopsy result?"


        rows={5}


        style={inputStyle}


      />




      <button

        onClick={searchPatientRAG}

        style={buttonStyle}

      >

        {
          loading
          ?
          "Searching..."
          :
          "Search"
        }


      </button>





      <div


        style={{

          marginTop:"20px",

          background:"#eef2ff",

          padding:"20px",

          borderRadius:"10px",

          whiteSpace:"pre-wrap"

        }}


      >



        <h3>
          Answer
        </h3>



        {answer}



      </div>




    </div>

  );

}





const inputStyle = {


  width:"100%",


  padding:"12px",


  margin:"10px 0",


  borderRadius:"6px",


  border:"1px solid #ccc",


  fontSize:"15px"


};





const buttonStyle = {


  padding:"12px 20px",


  background:"#2563eb",


  color:"white",


  border:"none",


  borderRadius:"6px",


  cursor:"pointer",


  marginTop:"10px"


};
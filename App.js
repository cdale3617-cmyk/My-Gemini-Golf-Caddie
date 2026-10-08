import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useKeepAwake } from "expo-keep-awake";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { calculatePlaysLike, displayToMetres, haversineMetres, makeDefaultBag, makeDefaultRound, metresToDisplay, recommendClub } from "./src/caddieEngine.js";
import HoleMap from "./src/HoleMap.js";
import { featuresForHole, fetchCourseFeatures, greenPinsByHole, osmCourseQuery } from "./src/courseMap.js";

async function golfApiRequest(path,key) {
  if(!key.trim())throw new Error("Open Settings and paste your GolfCourseAPI key first.");
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch("https://api.golfcourseapi.com/v1/"+path,{headers:{Accept:"application/json",Authorization:"Bearer "+key.trim()},signal:controller.signal});
    if(!response.ok)throw new Error(response.status===401?"API key not accepted. Check the key in Settings.":response.status===403?"Your GolfCourseAPI account has not allowed this request. Check account activation.":response.status===429?"GolfCourseAPI request limit reached. Try again after your allowance resets.":"GolfCourseAPI unavailable ("+response.status+"). Try again later.");
    return await response.json();
  }catch(e){if(e.name==="AbortError")throw new Error("GolfCourseAPI timed out. Check internet and try again.");throw e;}
  finally{clearTimeout(timer);}
}

function golfCourseName(c){
  return [...new Set([c.club_name,c.course_name].filter(Boolean))].join(" · ")||"Golf course";
}

function golfTeeOptions(c){
  return Object.entries(c.tees||{}).flatMap(([group,tees])=>Array.isArray(tees)?tees.filter(t=>Array.isArray(t.holes)&&t.holes.length>0&&t.holes.length<=18).map((t,i)=>({...t,id:group+":"+i,label:t.tee_name+" ("+group+")

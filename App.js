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
function golfCourseName(c){return [...new Set([c.club_name,c.course_name].filter(Boolean))].join(" · ")||"Golf course";}
function golfTeeOptions(c){
  return Object.entries(c.tees||{}).flatMap(([group,tees])=>Array.isArray(tees)?tees.filter(t=>Array.isArray(t.holes)&&t.holes.length>0&&t.holes.length<=18).map((t,i)=>({...t,id:group+":"+i,label:t.tee_name+" ("+group+")"})):[]);
}
function roundFromGolfTee(course,tee){
  return {courseName:golfCourseName(course),apiCourseId:course.id,teeName:tee.label,holes:tee.holes.map((h,i)=>({
    number:i+1,par:Number.isInteger(h.par)&&h.par>0?h.par:null,
    lengthM:Number.isFinite(h.meters)&&h.meters>0?h.meters:Number.isFinite(h.yardage)&&h.yardage>0?h.yardage*0.9144:null,
    score:"",pin:null
  }))};
}

function applyKnownCoursePars(round){
  if(!round||round.apiCourseId||!Array.isArray(round.holes)||!/(capricorn.*resort|resort.*capricorn)/i.test(round.courseName||""))return round;
  return {...round,holes:round.holes.map(h=>h.number===1?{...h,par:5}:h)};
}

const KEY="gemini-golf-caddie-v1", GOLD="#D9B45B", GREEN="#0D241B", PANEL="#142D23", MUTED="#AAB5AC", WHITE="#F5F4EC";

function Btn({label,onPress,primary=false,small=false}) {
  return <Pressable onPress={onPress} style={[S.btn,primary&&S.btnGold,small&&S.btnSmall]}><Text style={[S.btnText,primary&&{color:"#182419"}]}>{label}</Text></Pressable>;
}
function Field({label,value,onChangeText,type="default",placeholder}) {
  return <View style={{flex:1,marginVertical:5}}><Text style={S.label}>{label}</Text><TextInput value={String(value??"")} onChangeText={onChangeText} keyboardType={type} placeholder={placeholder} placeholderTextColor="#829087" selectionColor={GOLD} style={S.input}/></View>;
}
function Choice({values,value,onChange}) {
  return <View style={S.choiceRow}>{values.map(x=><Pressable key={x.value} onPress={()=>onChange(x.value)} style={[S.choice,value===x.value&&S.choiceOn]}><Text style={[S.choiceText,value===x.value&&{color:"#FFF1BE"}]}>{x.label}</Text></Pressable>)}</View>;
}
export default function App() {
  useKeepAwake();
  const [tab,setTab]=useState("Caddie"), [round,setRound]=useState(makeDefaultRound), [bag,setBag]=useState(makeDefaultBag);
  const [settings,setSettings]=useState({distanceUnit:"m",windUnit:"km/h",tournamentMode:false});
  const [loaded,setLoaded]=useState(false), [holeIndex,setHoleIndex]=useState(0), [gps,setGps]=useState(null), [gpsError,setGpsError]=useState("");
  const [gpsOn,setGpsOn]=useState(false), [windKmh,setWindKmh]=useState("0"), [windDir,setWindDir]=useState("calm"), [elevation,setElevation]=useState("0");
  const [courseResults,setCourseResults]=useState([]), [courseFeatures,setCourseFeatures]=useState([]), [courseStatus,setCourseStatus]=useState("Search for a course to load mapped hole features."), [courseBusy,setCourseBusy]=useState(false);
  const [shotType,setShotType]=useState("stock"), [transcript,setTranscript]=useState(""), [voiceStatus,setVoiceStatus]=useState("Voice is off"), [scoreInput,setScoreInput]=useState("");
  const [apiKey,setApiKey]=useState(""), [apiCourse,setApiCourse]=useState(null), [courseQuery,setCourseQuery]=useState("");
  const courseLock=useRef(false);
  const gpsWatch=useRef(null), hole=round.holes[holeIndex], unit=settings.distanceUnit;

  useEffect(()=>{
    (async()=>{try{const raw=await AsyncStorage.getItem(KEY);if(raw){const d=JSON.parse(raw);if(d.round?.holes?.length>0&&d.round.holes.length<=18)setRound(applyKnownCoursePars(d.round));if(d.bag?.length)setBag(d.bag);if(d.settings)setSettings(s=>({...s,...d.settings}));if(Array.isArray(d.courseFeatures)){setCourseFeatures(d.courseFeatures);if(d.courseFeatures.length)setCourseStatus("Saved course and OpenStreetMap features loaded from this phone.");}}}catch{setGpsError("Saved round could not be read. A fresh round is ready.");}finally{setLoaded(true);}})();
    return ()=>{gpsWatch.current?.remove();try{ExpoSpeechRecognitionModule.abort();}catch{}};
  },[]);
  useEffect(()=>{if(loaded)AsyncStorage.setItem(KEY,JSON.stringify({round,bag,settings,courseFeatures})).catch(()=>setGpsError("Could not save this change on the device."));},[round,bag,settings,courseFeatures,loaded]);

  const distanceM=useMemo(()=>haversineMetres(gps,hole.pin),[gps,hole.pin]);
  const elevationM=Number(elevation)*(unit==="yd"?0.9144:1);
  const playsLikeM=useMemo(()=>calculatePlaysLike({distanceM,windKmh:Number(windKmh),windDirection:windDir,elevationM,shotType,tournamentMode:settings.tournamentMode}),[distanceM,windKmh,windDir,elevationM,shotType,settings.tournamentMode]);
  const club=useMemo(()=>recommendClub(playsLikeM,bag),[playsLikeM,bag]);
  function say(message){Speech.stop();Speech.speak(message,{language:"en-AU",pitch:0.96,rate:0.92});}
  function editHole(patch){setRound(r=>({...r,holes:r.holes.map((h,i)=>i===holeIndex?{...h,...patch}:h)}));}
  function setHole(index){setHoleIndex((index+round.holes.length)%round.holes.length);}
  function editBag(index,patch){setBag(b=>b.map((c,i)=>i===index?{...c,...patch}:c));}
  async function startGps(){
    try{setGpsError("");const p=await Location.requestForegroundPermissionsAsync();if(!p.granted){setGpsError("Allow location in Android settings to use GPS.");return;}
      const here=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});setGps(here.coords);gpsWatch.current?.remove();
      gpsWatch.current=await Location.watchPositionAsync({accuracy:Location.Accuracy.High,timeInterval:2000,distanceInterval:2},pos=>setGps(pos.coords));setGpsOn(true);
    }catch{setGpsError("GPS could not get a fix. Turn Location on and try outside.");setGpsOn(false);}
  }
  function stopGps(){gpsWatch.current?.remove();gpsWatch.current=null;setGpsOn(false);}

  async function searchCourse(){
    if(courseLock.current)return;
    const query=(courseQuery||round.courseName).trim();
    if(!query){Alert.alert("Enter a course","Type the course name first.");return;}
    if(!apiKey.trim()){setTab("Settings");Alert.alert("Course API key needed","Paste your GolfCourseAPI key in Settings.");return;}
    courseLock.current=true;setCourseBusy(true);setCourseResults([]);setApiCourse(null);setCourseStatus("Searching GolfCourseAPI…");
    try{
      const data=await golfApiRequest("search?search_query="+encodeURIComponent(query),apiKey);
      if(!Array.isArray(data.courses))throw new Error("GolfCourseAPI returned an unreadable course list.");
      setCourseResults(data.courses);setCourseStatus(data.courses.length?"Choose your course, then your tees.":"No course found. Try a shorter name, such as Capricorn.");
    }catch(e){setCourseStatus(e.message||"Course search failed. Check internet.");}
    finally{courseLock.current=false;setCourseBusy(false);}
  }
  async function chooseApiCourse(result){
    if(courseLock.current)return;
    courseLock.current=true;setCourseBusy(true);setCourseStatus("Loading tees and scorecard…");
    try{
      const data=await golfApiRequest("courses/"+encodeURIComponent(result.id),apiKey);
      const course=data.course||data;
      if(!golfTeeOptions(course).length)throw new Error("No supported tee scorecard is available for this course.");
      setApiCourse(course);setCourseResults([]);setCourseStatus("Choose the tees you are playing.");
    }catch(e){setCourseStatus(e.message||"Could not load course details.");}
    finally{courseLock.current=false;setCourseBusy(false);}
  }
  function chooseApiTee(tee){
    if(courseLock.current||!apiCourse)return;
    const course=apiCourse;
    const load=async()=>{
      if(courseLock.current)return;
      courseLock.current=true;setCourseBusy(true);
      setRound(roundFromGolfTee(course,tee));setCourseQuery("");setHoleIndex(0);setScoreInput("");setCourseFeatures([]);setApiCourse(null);
      const lat=course.location?.latitude,lon=course.location?.longitude;
      const base="GolfCourseAPI scorecard loaded · "+tee.label+". ";
      try{
        if(!Number.isFinite(lat)||!Number.isFinite(lon)){setCourseStatus(base+"No course coordinates available for the map.");return;}
        setCourseStatus(base+"Loading OpenStreetMap hole features…");
        const elements=await fetchCourseFeatures(osmCourseQuery(lat,lon));
        const pins=greenPinsByHole(elements);setCourseFeatures(elements);
        setRound(r=>r.apiCourseId===course.id?{...r,holes:r.holes.map(h=>({...h,pin:pins[h.number]||null}))}:r);
        setCourseStatus(base+(elements.length?"OpenStreetMap features loaded; detail varies by hole.":"No detailed hole map available here."));
      }catch{setCourseStatus(base+"Map service unavailable. Scorecard remains saved.");}
      finally{courseLock.current=false;setCourseBusy(false);}
    };
    if(round.holes.some(h=>h.score))Alert.alert("Start selected course?","This replaces the current round and clears its scores.",[{text:"Cancel",style:"cancel"},{text:"Load course",onPress:load}]);else load();
  }
  function markGreen(){
    if(!gps){Alert.alert("GPS needed","Start GPS and wait for a location fix before marking the green.");return;}
    Alert.alert("Save green pin here?","The current GPS position will be saved for this hole on this phone.",[{text:"Cancel",style:"cancel"},{text:"Save pin",onPress:()=>editHole({pin:{latitude:gps.latitude,longitude:gps.longitude}})}]);
  }
  function saveScore(){const n=Number(scoreInput);if(!Number.isInteger(n)||n<1||n>15){Alert.alert("Check score","Enter a score from 1 to 15.");return;}editHole({score:String(n)});setScoreInput("");}
  async function startVoice(){
    try{const p=await ExpoSpeechRecognitionModule.requestPermissionsAsync();if(!p.granted){setVoiceStatus("Microphone permission is needed");return;}
      if(!ExpoSpeechRecognitionModule.isRecognitionAvailable()){setVoiceStatus("Speech service is unavailable on this phone");return;}
      setVoiceStatus("Listening — speak now");ExpoSpeechRecognitionModule.start({lang:"en-AU",interimResults:true,continuous:false,maxAlternatives:1});
    }catch{setVoiceStatus("Voice could not start. Check microphone permission.");}
  }
  function stopVoice(){try{ExpoSpeechRecognitionModule.stop();}catch{}setVoiceStatus("Voice is off");}
  function command(raw){
    const text=String(raw||"").trim().toLowerCase();if(!text)return;setTranscript(text);
    if(text.includes("mark green")||text.includes("lock pin")||text.includes("mark target"))markGreen();
    else if(text.includes("tournament mode")||text.includes("go official")){setSettings(s=>({...s,tournamentMode:true}));say("Tournament mode on. Elevation adjustment is off.");}
    else if(text.includes("practice mode")){setSettings(s=>({...s,tournamentMode:false}));say("Practice mode on.");}
    else if(text.includes("next hole"))setHole(holeIndex+1);
    else if(text.includes("previous hole")||text.includes("prev hole"))setHole(holeIndex-1);
    else if(text.includes("smooth shot")||text.includes("three quarter")){setShotType("smooth");say("Smooth shot selected.");}
    else if(text.includes("choke down")||text.includes("flighted")){setShotType("choke-down");say("Choke down selected.");}
    else if(text.includes("stock shot")||text.includes("full swing")){setShotType("stock");say("Stock shot selected.");}
    else if(text.includes("headwind")||text.includes("tailwind")||text.includes("crosswind")){
      const n=text.match(/\d+(?:\.\d+)?/);const speed=n?Number(n[0]):0;setWindKmh(String(settings.windUnit==="mph"?speed*1.609:speed));
      setWindDir(text.includes("headwind")?"head":text.includes("tailwind")?"tail":"cross");say("Wind updated.");
    } else if(text.includes("report")||text.includes("what do i hit")||text.includes("yardage")){
      if(!playsLikeM||!club)say("Set a green pin and get a GPS fix first.");else say("Plays like "+metresToDisplay(playsLikeM,unit)+" "+unit+". Try "+club.name+".");
    } else say("Try report yardage, mark green, next hole, headwind 15, or practice mode.");
  }
  useSpeechRecognitionEvent("start",()=>setVoiceStatus("Listening — speak now"));
  useSpeechRecognitionEvent("end",()=>setVoiceStatus("Voice is off"));
  useSpeechRecognitionEvent("error",e=>setVoiceStatus("Voice error: "+e.error));
  useSpeechRecognitionEvent("result",e=>{const text=e.results?.[0]?.transcript;if(text){setTranscript(text);if(e.isFinal)command(text);}});

  const tabs=["Caddie","My Bag","Scorecard","Settings"];
  return <KeyboardAvoidingView style={S.screen} behavior={Platform.OS==="ios"?"padding":undefined}>
    <ExpoStatusBar style="light"/><StatusBar barStyle="light-content" backgroundColor={GREEN}/>
    <View style={S.header}><View><Text style={S.brand}>GEMINI <Text style={{color:GOLD}}>GOLF CADDIE</Text></Text><Text style={S.brandSub}>YOUR ROUND · SAVED ON THIS PHONE</Text></View><View style={[S.gpsPill,gps&&{borderColor:GOLD}]}><View style={[S.dot,gps&&{backgroundColor:"#75D391"}]}/><Text style={S.gpsText}>{gps?"GPS FIX":"GPS OFF"}</Text></View></View>
    <View style={S.tabs}>{tabs.map(t=><Pressable key={t} onPress={()=>setTab(t)} style={[S.tab,tab===t&&S.tabActive]}><Text style={[S.tabText,tab===t&&{color:GOLD}]}>{t}</Text></Pressable>)}</View>
    <ScrollView style={{flex:1}} contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
      {!loaded&&<Text style={S.muted}>Opening saved round…</Text>}
      {tab==="Caddie"&&<>
        <View style={S.courseRow}><View style={{flex:1}}><Text style={S.goldLabel}>CURRENT COURSE</Text><TextInput value={courseQuery} editable={!courseBusy} onChangeText={setCourseQuery} placeholder={round.courseName==="My Course"?"Enter course name":round.courseName} placeholderTextColor="#829087" style={S.courseInput}/></View><Btn label={gpsOn?"STOP GPS":"START GPS"} primary={!gpsOn} small onPress={gpsOn?stopGps:startGps}/></View>
        <Btn label={courseBusy?"SEARCHING…":"FIND COURSE"} onPress={searchCourse} small/>
        {courseResults.map(item=><Pressable disabled={courseBusy} key={item.id} onPress={()=>chooseApiCourse(item)} style={S.courseResult}><Text style={S.courseResultName}>{golfCourseName(item)}</Text><Text style={S.courseResultSub}>{item.location?.address||[item.location?.city,item.location?.country].filter(Boolean).join(", ")}</Text></Pressable>)}
        {apiCourse&&golfTeeOptions(apiCourse).map(tee=><Btn key={tee.id} label={tee.label+" · "+tee.holes.length+" holes"} onPress={()=>chooseApiTee(tee)}/>)}
        {round.teeName&&<Text style={S.muted}>TEES: {round.teeName}</Text>}
        <View style={S.holeNav}><Btn label="‹ PREV" small onPress={()=>setHole(holeIndex-1)}/><View style={{alignItems:"center"}}><Text style={S.holeTitle}>HOLE {hole.number}</Text><Text style={S.muted}>PAR {hole.par??"—"} · {metresToDisplay(hole.lengthM,unit)} {unit}</Text></View><Btn label="NEXT ›" small onPress={()=>setHole(holeIndex+1)}/></View>
        <View style={S.holeCard}><View style={S.holeHead}><Text style={S.goldLabel}>HOLE {hole.number} · PAR {hole.par??"—"}</Text><Text style={S.whiteSmall}>{distanceM==null?"PIN NOT SET":metresToDisplay(distanceM,unit)+" "+unit+" to pin"}</Text></View><HoleMap features={featuresForHole(courseFeatures,hole.number)} status={courseStatus}/></View>
        <Text style={S.courseStatus}>{courseStatus}</Text>
        <View style={S.pinRow}><Text style={S.muted}>{hole.pin?"Green pin saved for this hole":"Save a pin at the green to start GPS distance"}</Text><Btn label="MARK GREEN HERE" small onPress={markGreen}/></View>
        <View style={S.metrics}><View style={S.metric}><Text style={S.label}>TO PIN</Text><Text style={S.metricValue}>{distanceM==null?"—":metresToDisplay(distanceM,unit)}</Text><Text style={S.muted}>{unit}</Text></View><View style={S.vline}/><View style={S.metric}><Text style={S.label}>PLAYS LIKE</Text><Text style={[S.metricValue,{color:GOLD}]}>{playsLikeM?metresToDisplay(playsLikeM,unit):"—"}</Text><Text style={S.muted}>{distanceM?unit:"set pin"}</Text></View><View style={S.vline}/><View style={S.metric}><Text style={S.label}>CLUB IDEA</Text><Text style={[S.club,{color:GOLD}]}>{club?.name||"—"}</Text><Text style={S.tiny}>edit carry in My Bag</Text></View></View>
        <View style={S.section}><Text style={S.sectionTitle}>SHOT CONDITIONS</Text>
          <Field label={"WIND ("+settings.windUnit+")"} value={settings.windUnit==="mph"?Math.round(Number(windKmh)/1.609):windKmh} onChangeText={v=>setWindKmh(String(settings.windUnit==="mph"?Number(v||0)*1.609:v))} type="decimal-pad"/>
          <Choice value={windDir} onChange={setWindDir} values={[{label:"CALM",value:"calm"},{label:"HEAD",value:"head"},{label:"TAIL",value:"tail"},{label:"CROSS",value:"cross"}]}/>
          {!settings.tournamentMode&&<Field label={"ELEVATION ("+unit+", up is +)"} value={elevation} onChangeText={setElevation} type="decimal-pad"/>}
          <Text style={S.label}>SHOT TYPE</Text><Choice value={shotType} onChange={setShotType} values={[{label:"STOCK",value:"stock"},{label:"SMOOTH",value:"smooth"},{label:"CHOKE DOWN",value:"choke-down"}]}/>
          {settings.tournamentMode&&<Text style={S.notice}>Tournament mode: manual elevation adjustment is off.</Text>}
        </View>
        <View style={S.section}><Text style={S.sectionTitle}>VOICE CADDIE</Text><View style={S.row}><Btn label={voiceStatus.startsWith("Listening")?"LISTENING…":"TAP TO SPEAK"} primary onPress={startVoice}/><Btn label="STOP" onPress={stopVoice}/></View><Text style={S.muted}>{voiceStatus}</Text>{transcript?<Text style={S.transcript}>“{transcript}”</Text>:null}<Text style={S.help}>Try report yardage, mark green, headwind 15, next hole, or practice mode.</Text></View>
      </>}
      {tab==="My Bag"&&<View style={S.section}><Text style={S.pageTitle}>MY BAG</Text><Text style={S.muted}>Edit these example carries to match your own clubs.</Text>{bag.map((c,i)=><View key={c.name} style={S.bagRow}><Text style={S.bagName}>{c.name}</Text><View style={S.bagField}><Text style={S.label}>CARRY ({unit})</Text><TextInput keyboardType="decimal-pad" style={S.smallInput} value={String(metresToDisplay(c.carryM,unit))} onChangeText={v=>editBag(i,{carryM:displayToMetres(v,unit)})}/></View><View style={S.bagField}><Text style={S.label}>LOFT °</Text><TextInput keyboardType="decimal-pad" style={S.smallInput} value={String(c.loft)} onChangeText={v=>editBag(i,{loft:Number(v)||0})}/></View></View>)}</View>}
      {tab==="Scorecard"&&<View style={S.section}><Text style={S.pageTitle}>SCORECARD</Text><Text style={S.muted}>{round.courseName} · saved on this phone</Text><View style={S.scoreEntry}><View style={{flex:1}}><Text style={S.goldLabel}>HOLE {hole.number} · PAR {hole.par??"—"}</Text><Field label="SCORE" value={scoreInput} onChangeText={setScoreInput} type="number-pad" placeholder={hole.score||"Enter score"}/></View><Btn label="SAVE" primary small onPress={saveScore}/></View>{round.holes.map((h,i)=><Pressable key={h.number} onPress={()=>setHole(i)} style={[S.scoreRow,i===holeIndex&&{backgroundColor:"#203C30"}]}><Text style={S.scoreHole}>Hole {h.number}</Text><Text style={S.muted}>Par {h.par??"—"}</Text><Text style={S.scoreValue}>{h.score||"—"}</Text></Pressable>)}<Btn label="NEW ROUND" onPress={()=>Alert.alert("Start a new round?","This clears hole scores and keeps your course, tees and green pins.",[{text:"Cancel",style:"cancel"},{text:"New round",style:"destructive",onPress:()=>{setRound(r=>({...r,holes:r.holes.map(h=>({...h,score:""}))}));setHoleIndex(0);}}])}/></View>}
      {tab==="Settings"&&<View style={S.section}><Text style={S.pageTitle}>SETTINGS</Text><Text style={S.sectionTitle}>GOLFCOURSEAPI KEY</Text><TextInput value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste your API key here" placeholderTextColor="#829087" style={S.input}/><Text style={S.help}>The key stays in memory while this app is open. Paste it again after restarting. Your downloaded scorecard stays saved.</Text><View style={S.row}><Btn label="USE KEY" primary onPress={()=>{if(!apiKey.trim()){Alert.alert("Key needed","Paste your GolfCourseAPI key first.");return;}setApiKey(apiKey.trim());setTab("Caddie");setCourseStatus("Key entered. Type your course name and tap FIND COURSE to check it.");}}/><Btn label="CLEAR KEY" onPress={()=>setApiKey("")}/></View><Text style={S.sectionTitle}>DISTANCE</Text><Choice value={unit} onChange={v=>setSettings(s=>({...s,distanceUnit:v}))} values={[{label:"METRES",value:"m"},{label:"YARDS",value:"yd"}]}/><Text style={S.sectionTitle}>WIND SPEED</Text><Choice value={settings.windUnit} onChange={v=>setSettings(s=>({...s,windUnit:v}))} values={[{label:"KM/H",value:"km/h"},{label:"MPH",value:"mph"}]}/><Text style={S.sectionTitle}>ROUND MODE</Text><Choice value={settings.tournamentMode?"tournament":"practice"} onChange={v=>setSettings(s=>({...s,tournamentMode:v==="tournament"}))} values={[{label:"PRACTICE",value:"practice"},{label:"TOURNAMENT",value:"tournament"}]}/><Text style={S.notice}>Check your competition’s local rules before using distance advice. Tournament mode turns off manual elevation adjustment.</Text><Text style={S.sectionTitle}>ABOUT THIS BUILD</Text><Text style={S.muted}>Search for a course to load mapped hole features. OpenStreetMap detail varies by course. GPS distance uses a mapped green pin when available or a pin you save yourself. Course features are saved on this phone.</Text></View>}
      {gpsError?<Text style={S.error}>{gpsError}</Text>:null}<Text style={S.footer}>Plays-like and club suggestions are estimates. Check your own carry numbers and course conditions.</Text>
    </ScrollView>
    <View style={S.bottom}><Text style={S.bottomText}>ONE HOLE AT A TIME</Text><Text style={[S.bottomText,{color:GOLD,marginTop:3}]}>{distanceM==null?"SAVE GREEN PIN FOR GPS DISTANCE":"LIVE GPS DISTANCE ACTIVE"}</Text></View>
  </KeyboardAvoidingView>;
}

const S=StyleSheet.create({
  screen:{flex:1,backgroundColor:GREEN},header:{paddingTop:10,paddingHorizontal:16,paddingBottom:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},brand:{color:WHITE,fontSize:18,fontWeight:"900",letterSpacing:1},brandSub:{color:MUTED,fontSize:9,letterSpacing:1.3,marginTop:3,fontWeight:"700"},gpsPill:{flexDirection:"row",alignItems:"center",borderColor:"#526158",borderWidth:1,borderRadius:18,paddingVertical:7,paddingHorizontal:10},dot:{width:7,height:7,borderRadius:4,backgroundColor:"#777"},gpsText:{color:WHITE,fontSize:10,fontWeight:"800",marginLeft:6},
  tabs:{flexDirection:"row",borderTopWidth:1,borderBottomWidth:1,borderColor:"#315044",backgroundColor:"#10271E"},tab:{flex:1,paddingVertical:12,alignItems:"center"},tabActive:{borderBottomWidth:2,borderColor:GOLD},tabText:{color:MUTED,fontSize:10,fontWeight:"800"},content:{padding:13,paddingBottom:18},courseRow:{flexDirection:"row",alignItems:"flex-end",gap:9,backgroundColor:PANEL,padding:11,borderRadius:14,marginBottom:7,borderWidth:1,borderColor:"#2A493B"},courseResult:{padding:9,backgroundColor:"#203C30",borderRadius:9,marginTop:5,borderWidth:1,borderColor:"#496150"},courseResultName:{color:WHITE,fontSize:12,fontWeight:"800"},courseResultSub:{color:MUTED,fontSize:9,marginTop:3},courseStatus:{color:MUTED,fontSize:9,lineHeight:13,marginBottom:8},goldLabel:{color:GOLD,fontSize:10,fontWeight:"900",letterSpacing:1},courseInput:{color:WHITE,fontSize:17,fontWeight:"800",paddingVertical:5},holeNav:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:9},holeTitle:{color:WHITE,fontSize:17,fontWeight:"900",letterSpacing:1},
  btn:{minHeight:41,paddingHorizontal:12,paddingVertical:9,borderRadius:10,backgroundColor:"#203C30",borderWidth:1,borderColor:"#496150",alignItems:"center",justifyContent:"center"},btnSmall:{minHeight:34,paddingHorizontal:9,paddingVertical:6},btnGold:{backgroundColor:GOLD,borderColor:GOLD},btnText:{color:WHITE,fontSize:10,fontWeight:"900",letterSpacing:.4},muted:{color:MUTED,fontSize:11,lineHeight:16},label:{color:MUTED,fontSize:9,fontWeight:"800",letterSpacing:.5,marginBottom:4},input:{color:WHITE,fontSize:15,borderBottomWidth:1,borderColor:"#526B59",paddingVertical:6},
  choiceRow:{flexDirection:"row",flexWrap:"wrap",gap:6,marginVertical:6},choice:{borderRadius:8,borderWidth:1,borderColor:"#526B59",paddingHorizontal:9,paddingVertical:8,backgroundColor:"#10251B"},choiceOn:{backgroundColor:"#594C26",borderColor:GOLD},choiceText:{color:MUTED,fontSize:9,fontWeight:"900"},holeCard:{backgroundColor:PANEL,borderRadius:15,borderWidth:1,borderColor:"#385541",overflow:"hidden",marginBottom:9},holeHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingHorizontal:12,paddingVertical:9},whiteSmall:{color:WHITE,fontSize:10,fontWeight:"700"},
  art:{height:218,backgroundColor:"#143525",overflow:"hidden",alignItems:"center"},fairwayWide:{position:"absolute",top:-12,width:140,height:250,borderRadius:72,backgroundColor:"#739459"},fairwayNarrow:{position:"absolute",top:0,width:98,height:240,borderRadius:55,backgroundColor:"#86A964"},greenShape:{position:"absolute",width:112,height:58,borderRadius:36,backgroundColor:"#A5BD70",borderWidth:2,borderColor:"#D5D991"},flagPole:{position:"absolute",width:2,height:24,backgroundColor:WHITE},flag:{position:"absolute",width:13,height:8,marginLeft:3,backgroundColor:"#C55A4A"},bunkerL:{position:"absolute",top:110,marginLeft:-80,width:32,height:16,backgroundColor:"#D7C79B",borderRadius:18,transform:[{rotate:"-18deg"}]},bunkerR:{position:"absolute",top:150,marginLeft:59,width:30,height:15,backgroundColor:"#D7C79B",borderRadius:18},water:{position:"absolute",bottom:35,marginLeft:79,width:44,height:18,borderRadius:18,backgroundColor:"#315E6A"},tee:{position:"absolute",bottom:27,width:12,height:12,borderRadius:6,backgroundColor:GOLD,borderWidth:2,borderColor:WHITE},artGreenLabel:{position:"absolute",color:"#18301F",fontSize:9,fontWeight:"900"},teeLabel:{position:"absolute",bottom:8,color:WHITE,fontSize:9,fontWeight:"900"},artNote:{position:"absolute",bottom:4,left:6,color:"#D5E2D5",fontSize:7,letterSpacing:.3},
  pinRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:5,marginBottom:9},metrics:{backgroundColor:"#091A13",borderRadius:15,borderWidth:1,borderColor:GOLD,paddingVertical:12,paddingHorizontal:5,flexDirection:"row",alignItems:"center",justifyContent:"space-around"},metric:{flex:1,alignItems:"center"},metricValue:{color:WHITE,fontSize:28,fontWeight:"900"},club:{fontSize:14,fontWeight:"900",marginTop:7},tiny:{color:MUTED,fontSize:8,textAlign:"center"},vline:{width:1,height:45,backgroundColor:"#3D5544"},
  section:{backgroundColor:PANEL,padding:13,borderRadius:14,borderWidth:1,borderColor:"#2A493B",marginTop:11},sectionTitle:{color:GOLD,fontSize:11,fontWeight:"900",letterSpacing:1,marginBottom:8,marginTop:4},row:{flexDirection:"row",gap:8,marginVertical:5},transcript:{color:WHITE,fontSize:13,marginTop:7,fontStyle:"italic"},help:{color:MUTED,fontSize:10,lineHeight:15,marginTop:7},notice:{color:"#F1D99B",backgroundColor:"#403A22",padding:9,borderRadius:8,fontSize:10,lineHeight:15,marginTop:8},pageTitle:{color:WHITE,fontSize:22,fontWeight:"900",marginBottom:6,letterSpacing:1},
  bagRow:{flexDirection:"row",alignItems:"center",gap:7,borderBottomWidth:1,borderColor:"#304739",paddingVertical:7},bagName:{color:WHITE,fontSize:12,fontWeight:"800",width:65},bagField:{flex:1},smallInput:{color:WHITE,fontSize:14,fontWeight:"700",borderBottomWidth:1,borderColor:"#526B59",paddingVertical:4},scoreEntry:{flexDirection:"row",alignItems:"flex-end",gap:9,marginTop:11,marginBottom:7},scoreRow:{minHeight:40,borderBottomWidth:1,borderColor:"#2C4538",flexDirection:"row",alignItems:"center",paddingHorizontal:8,gap:17},scoreHole:{color:WHITE,flex:1,fontWeight:"700"},scoreValue:{color:GOLD,fontSize:15,fontWeight:"900",width:30,textAlign:"center"},error:{color:"#FFC2B8",backgroundColor:"#442620",borderRadius:9,padding:9,marginTop:10,fontSize:11},footer:{color:"#91A197",fontSize:9,lineHeight:14,textAlign:"center",marginVertical:13,paddingHorizontal:7},bottom:{backgroundColor:"#08170F",borderTopWidth:1,borderColor:"#31493A",paddingVertical:7,alignItems:"center"},bottomText:{color:MUTED,fontSize:8,fontWeight:"900",letterSpacing:1.3}
});



    <View style={S.tabs}>
      {["Caddie","My Bag","Scorecard","Settings"].map(t=>
        <Pressable key={t} onPress={()=>setTab(t)}
          style={[S.tab,tab===t&&{borderBottomColor:GOLD,borderBottomWidth:2}]}>
          <Text style={S.small}>{t}</Text>
        </Pressable>
      )}
    </View>

    <ScrollView style={{flex:1}}
      contentContainerStyle={{padding:12,paddingBottom:30}}
      keyboardShouldPersistTaps="handled">

      {tab==="Caddie"&&<>
        <View style={S.panel}>
          <Field label="COURSE" value={query} onChange={setQuery}
            placeholder={round.courseName}/>
          <Btn label={gpsOn?"STOP GPS":"START GPS"}
            primary onPress={gpsOn?stopGps:startGps}/>
        </View>

        <Btn label={busy?"LOADING...":"FIND COURSE"} onPress={search}/>

        {results.map(c=>
          <Pressable key={c.id} style={S.panel} onPress={()=>chooseCourse(c)}>
            <Text style={S.white}>{courseName(c)}</Text>
            <Text style={S.small}>{c.location?.address||c.location?.city||""}</Text>
          </Pressable>
        )}

        {selected&&teeOptions(selected).map(t=>
          <Btn key={t.id} label={t.label+" · "+t.holes.length+" holes"}
            onPress={()=>chooseTee(t)}/>
        )}

        <View style={[S.row,{justifyContent:"space-between",marginTop:12}]}>
          <Btn label="PREV" onPress={()=>go(index-1)}/>
          <View>
            <Text style={S.heading}>HOLE {hole.number}</Text>
            <Text style={S.small}>
              PAR {hole.par??"—"} · {metresToDisplay(hole.lengthM,unit)} {unit}
            </Text>
          </View>
          <Btn label="NEXT" onPress={()=>go(index+1)}/>
        </View>

        <View style={S.panel}>
          <Text style={S.gold}>HOLE {hole.number} · PAR {hole.par??"—"}</Text>
          <HoleMap features={featuresForHole(features,hole.number)}
            status={status}/>
        </View>

        <Text style={S.small}>{status}</Text>

        <View style={S.panel}>
          <Text style={S.small}>{hole.pin?"Green pin saved":"Pin not set"}</Text>
          <Btn label="MARK GREEN HERE" onPress={markGreen}/>
        </View>

        <View style={S.row}>
          {[
            ["TO PIN",distance==null?"—":metresToDisplay(distance,unit)],
            ["PLAYS LIKE",distance==null?"—":metresToDisplay(plays,unit)],
            ["CLUB",club?.name||"—"]
          ].map(([k,v])=>
            <View key={k} style={S.metric}>
              <Text style={S.small}>{k}</Text>
              <Text style={S.number}>{v}</Text>
            </View>
          )}
        </View>

        <View style={S.panel}>
          <Text style={S.gold}>SHOT CONDITIONS</Text>
          <Field label={"WIND ("+settings.windUnit+")"}
            value={settings.windUnit==="mph"
              ?String(Math.round(Number(wind)/1.609)):wind}
            onChange={v=>setWind(String(settings.windUnit==="mph"
              ?Number(v||0)*1.609:v))}
            type="decimal-pad"/>
          <Choice value={windDir} onChange={setWindDir}
            options={[
              ["CALM","calm"],["HEAD","head"],
              ["TAIL","tail"],["CROSS","cross"]
            ]}/>
          {!settings.tournamentMode&&
            <Field label={"ELEVATION ("+unit+")"}
              value={elevation} onChange={setElevation}
              type="decimal-pad"/>}
          <Text style={S.gold}>SHOT TYPE</Text>
          <Choice value={shotType} onChange={setShotType}
            options={[
              ["STOCK","stock"],["SMOOTH","smooth"],
              ["CHOKE","choke-down"]
            ]}/>
        </View>

        <View style={S.panel}>
          <Text style={S.gold}>VOICE CADDIE</Text>
          <View style={S.row}>
            <Btn label="TAP TO SPEAK" primary onPress={startVoice}/>
            <Btn label="STOP" onPress={stopVoice}/>
          </View>
          <Text style={S.small}>{voice}</Text>
          <Text style={S.white}>{transcript}</Text>
        </View>
      </>}

      {tab==="My Bag"&&
        <View style={S.panel}>
          <Text style={S.heading}>MY BAG</Text>
          {bag.map((c,i)=>
            <View key={i} style={S.row}>
              <Text style={[S.white,{width:65}]}>{c.name}</Text>
              <Field label={"CARRY "+unit}
                value={metresToDisplay(c.carryM,unit)}
                type="decimal-pad"
                onChange={v=>setBag(b=>b.map((x,j)=>
                  i===j?{...x,carryM:displayToMetres(v,unit)}:x))}/>
              <Field label="LOFT" value={c.loft}
                type="decimal-pad"
                onChange={v=>setBag(b=>b.map((x,j)=>
                  i===j?{...x,loft:Number(v)||0}:x))}/>
            </View>
          )}
        </View>
      }

      {tab==="Scorecard"&&
        <View style={S.panel}>
          <Text style={S.heading}>SCORECARD</Text>
          <Text style={S.small}>{round.courseName}</Text>
          <View style={S.row}>
            <Field label={"HOLE "+hole.number+" SCORE"}
              value={score} onChange={setScore}
              type="number-pad" placeholder={hole.score||"Score"}/>
            <Btn label="SAVE" primary onPress={saveScore}/>
          </View>
          {round.holes.map((h,i)=>
            <Pressable key={i} onPress={()=>go(i)} style={S.scoreRow}>
              <Text style={S.white}>Hole {h.number}</Text>
              <Text style={S.small}>Par {h.par??"—"}</Text>
              <Text style={S.gold}>{h.score||"—"}</Text>
            </Pressable>
          )}
          <Btn label="NEW ROUND" onPress={()=>
            Alert.alert("New round?","Clear saved scores?",[
              {text:"Cancel"},
              {text:"Clear",onPress:()=>{
                setRound(r=>({...r,holes:r.holes.map(h=>({...h,score:""}))}));
                go(0);
              }}
            ])
          }/>
        </View>
      }

      {tab==="Settings"&&
        <View style={S.panel}>
          <Text style={S.heading}>SETTINGS</Text>
          <Text style={S.gold}>GOLFCOURSEAPI KEY</Text>
          <TextInput value={apiKey} onChangeText={setApiKey}
            secureTextEntry autoCapitalize="none" autoCorrect={false}
            placeholder="Paste original API key"
            placeholderTextColor="#829087" style={S.input}/>
          <Text style={S.small}>
            Paste the actual key, not masked dots.
            The key is not saved after closing the app.
          </Text>
          <View style={S.row}>
            <Btn label="USE KEY" primary onPress={()=>{
              try{
                setApiKey(checkKey(apiKey));
                setTab("Caddie");
                setStatus("Key entered. Find a course to test it.");
              }catch(e){Alert.alert("Invalid API key",e.message);}
            }}/>
            <Btn label="CLEAR" onPress={()=>setApiKey("")}/>
          </View>
          <Text style={S.gold}>DISTANCE</Text>
          <Choice value={unit}
            onChange={v=>setSettings(s=>({...s,distanceUnit:v}))}
            options={[["METRES","m"],["YARDS","yd"]]}/>
          <Text style={S.gold}>WIND SPEED</Text>
          <Choice value={settings.windUnit}
            onChange={v=>setSettings(s=>({...s,windUnit:v}))}
            options={[["KM/H","km/h"],["MPH","mph"]]}/>
          <Text style={S.gold}>ROUND MODE</Text>
          <Choice value={settings.tournamentMode?"tournament":"practice"}
            onChange={v=>setSettings(s=>({...s,tournamentMode:v==="tournament"}))}
            options={[["PRACTICE","practice"],["TOURNAMENT","tournament"]]}/>
          <Text style={S.small}>
            Always check competition rules before using electronic caddie advice.
          </Text>
        </View>
      }

      <Text style={[S.small,{textAlign:"center",marginTop:14}]}>
        GPS distances and club advice are estimates.
      </Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const S=StyleSheet.create({
  screen:{flex:1,backgroundColor:GREEN},
  header:{padding:14,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  brand:{fontSize:17,fontWeight:"900",color:WHITE},
  tabs:{flexDirection:"row",backgroundColor:"#10271E"},
  tab:{flex:1,paddingVertical:14,alignItems:"center"},
  panel:{backgroundColor:PANEL,padding:12,borderRadius:12,borderColor:"#385541",borderWidth:1,marginVertical:7},
  btn:{backgroundColor:"#203C30",borderColor:"#496150",borderWidth:1,borderRadius:9,padding:10,alignItems:"center",justifyContent:"center",margin:3,minHeight:38},
  primary:{backgroundColor:GOLD,borderColor:GOLD},
  btnText:{color:WHITE,fontSize:10,fontWeight:"900"},
  heading:{color:WHITE,fontSize:19,fontWeight:"900",textAlign:"center",marginVertical:5},
  white:{color:WHITE,fontSize:12,fontWeight:"700"},
  gold:{color:GOLD,fontSize:11,fontWeight:"900",marginVertical:7},
  small:{color:MUTED,fontSize:10,lineHeight:16},
  label:{color:MUTED,fontSize:10,fontWeight:"700"},
  input:{color:WHITE,borderBottomWidth:1,borderColor:"#526B59",fontSize:15,paddingVertical:7},
  row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:5,marginVertical:6},
  choice:{padding:9,borderWidth:1,borderColor:"#526B59",borderRadius:8},
  metric:{flex:1,alignItems:"center",backgroundColor:"#091A13",borderColor:GOLD,borderWidth:1,borderRadius:9,padding:8},
  number:{color:GOLD,fontSize:19,fontWeight:"900"},
  scoreRow:{flexDirection:"row",justifyContent:"space-between",padding:12,borderBottomWidth:1,borderColor:"#304739"}
});

<template>
  <div class="report-trend" :class="{empty:!rows.length}">
    <div v-if="rows.length" ref="plot" class="report-chart-plot">
      <svg :viewBox="'0 0 '+width+' 228'" preserveAspectRatio="none" role="img" :aria-label="'每日'+label+'趋势，'+rows.length+'个有记录日期'">
        <defs><linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" :stop-color="color" stop-opacity=".16"/><stop offset="100%" :stop-color="color" stop-opacity="0"/></linearGradient></defs>
        <g v-for="tick in ticks" :key="tick.y"><line x1="45" :x2="width-14" :y1="tick.y" :y2="tick.y" stroke="#e9eef5" stroke-dasharray="3 5"/><text x="34" :y="tick.y+4" text-anchor="end" fill="#91a0b3" font-size="11">{{ compact(tick.value) }}</text></g>
        <g v-for="(group,index) in groups" :key="index"><path v-if="group.length>1" :d="area(group)" :fill="'url(#'+gradientId+')'"/><path v-if="group.length>1" :d="line(group)" fill="none" :stroke="color" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></g>
        <line v-if="selected" :x1="selected.x" :x2="selected.x" y1="15" y2="192" :stroke="color" stroke-opacity=".3" stroke-dasharray="4 4"/>
        <circle v-for="point in points" :key="point.day" :cx="point.x" :cy="point.y" :r="selected?.day===point.day ? 5 : 3.5" fill="white" :stroke="color" stroke-width="2"/>
        <text v-for="tick in xTicks" :key="tick.day" :x="tick.x" y="219" :text-anchor="tick.anchor" fill="#91a0b3" font-size="11">{{ tick.day.slice(5).replace('-','/') }}</text>
      </svg>
      <button v-for="point in points" :key="point.day" class="report-chart-hit" :style="{left:(point.x/width*100)+'%',top:(point.y/228*100)+'%'}" :aria-label="point.day+'，'+label+point.value+'次'" @mouseenter="focused=point.day" @mouseleave="focused=null" @focus="focused=point.day" @blur="focused=null" />
      <div v-if="selected" class="report-chart-tooltip" role="status" :style="{left:Math.max(23,Math.min(77,selected.x/width*100))+'%',top:Math.max(9,selected.y/228*100-29)+'%'}"><span>{{ selected.day }}</span><b><i :style="{background:color}"/>{{ label }} {{ selected.value.toLocaleString('zh-CN') }} 次</b></div>
    </div>
    <div v-else class="report-chart-empty"><span class="report-empty-chart"><i/><i/><i/><i/><IconBarChart /></span><b>投放趋势，等待第一笔记录</b><p>当前统计口径暂无已记录事件<br/>有记录后，这里会呈现每日曝光与点击走势。</p></div>
  </div>
</template>
<script setup>
import { computed,onBeforeUnmount,ref,useId,watch } from 'vue';
import { IconBarChart } from '@arco-design/web-vue/es/icon';
const props=defineProps({rows:{type:Array,required:true},metric:{type:String,required:true},label:{type:String,required:true}});
const gradientId='report-trend-'+useId().replace(/[^a-zA-Z0-9-]/g,''),focused=ref(null);
const plot=ref(null),width=ref(720);let observer;
watch(plot,element=>{observer?.disconnect();if(element){width.value=Math.max(240,element.clientWidth);observer=new ResizeObserver(entries=>width.value=Math.max(240,entries[0].contentRect.width));observer.observe(element);}});
onBeforeUnmount(()=>observer?.disconnect());
const color=computed(()=>props.metric==='clicks'?'#419b8e':'#617de0');
const maximum=computed(()=>{const n=Math.max(1,...props.rows.map(row=>row[props.metric])),raw=n/3,power=10**Math.floor(Math.log10(raw));const step=[1,2,5,10].map(value=>value*power).find(value=>value>=raw);return Math.max(1,step)*3;});
const points=computed(()=>{const dates=props.rows.map(row=>Date.parse(row.day));const first=Math.min(...dates),last=Math.max(...dates);return props.rows.map((row,index)=>({day:row.day,value:row[props.metric],x:last===first?(width.value+38)/2:52+(dates[index]-first)/(last-first)*(width.value-74),y:192-row[props.metric]/maximum.value*165}));});
const groups=computed(()=>{const result=[];for(const point of points.value){const last=result.at(-1);if(last && Date.parse(point.day)-Date.parse(last.at(-1).day)===86400000)last.push(point);else result.push([point]);}return result;});
const ticks=computed(()=>[0,1,2,3].map(index=>({value:maximum.value*index/3,y:192-index*55})));
const xTicks=computed(()=>{const all=points.value;if(all.length<2)return all.map(row=>({...row,anchor:'middle'}));const indexes=[0,...(all.length>3?[Math.floor((all.length-1)/2)]:[]),all.length-1];return indexes.map((index,i)=>({...all[index],anchor:i===0?'start':i===indexes.length-1?'end':'middle'}));});
const selected=computed(()=>points.value.find(row=>row.day===focused.value));
const line=group=>group.map((point,index)=>(index?'L':'M')+point.x+' '+point.y).join(' ');
const area=group=>line(group)+` L${group.at(-1).x} 192 L${group[0].x} 192 Z`;
const compact=n=>n>=10000?(n/10000).toFixed(1).replace(/\.0$/,'')+'万':Number(n.toFixed(1)).toLocaleString('zh-CN');
watch(()=>[props.rows,props.metric],()=>focused.value=null);
</script>

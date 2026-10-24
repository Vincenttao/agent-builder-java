package com.openjiuwen.workbench;
import com.openjiuwen.extensions.tracerotel.*;
public final class OtelProbe {
 public static void main(String[] args){
  var config=OtelTracerConfig.builder().exporterType("otlp").protocol("http").exporterEndpoint("http://127.0.0.1:14318").serviceName("workbench-otel-probe").scheduleDelayMillis(100).build();
  var tracer=OtelTracerSetup.initOtelTracer(config);var span=tracer.spanBuilder("fixed-protocol-probe").startSpan();
  System.out.println("TRACE_ID="+span.getSpanContext().getTraceId());span.end();System.out.println("FLUSH="+OtelTracerSetup.forceFlushOtelTracer());OtelTracerSetup.shutdownOtelTracer();
 }
}

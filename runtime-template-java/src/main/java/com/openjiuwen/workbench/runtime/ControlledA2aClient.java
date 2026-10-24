package com.openjiuwen.workbench.runtime;

import org.a2aproject.sdk.client.*;
import org.a2aproject.sdk.client.config.ClientConfig;
import org.a2aproject.sdk.client.http.JdkA2AHttpClient;
import org.a2aproject.sdk.client.transport.jsonrpc.*;
import org.a2aproject.sdk.spec.*;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** The Runtime-pinned official A2A 1.0 SDK, limited to nonstreaming controlled Task responses. */
public final class ControlledA2aClient implements AutoCloseable {
    private final Map<String,String> targets;
    private final ExecutorService executor=Executors.newSingleThreadExecutor(r->{var thread=new Thread(r,"controlled-a2a");thread.setDaemon(true);return thread;});
    public ControlledA2aClient(Map<String,String> targets){this.targets=Map.copyOf(targets);}
    public Task send(String target,String context,String taskId,String text){
        String url=targets.get(target);if(url==null)throw new IllegalArgumentException("UNMOUNTED_A2A_TARGET");
        if(context==null||context.isBlank()||text==null||text.isBlank())throw new IllegalArgumentException("A2A_CONTEXT_AND_INPUT_REQUIRED");
        var work=executor.submit(()->invoke(target,url,context,taskId,text));
        try{return work.get(12,TimeUnit.SECONDS);
        }catch(InterruptedException e){work.cancel(true);Thread.currentThread().interrupt();throw new IllegalStateException("A2A_CANCELLED");
        }catch(Exception e){work.cancel(true);throw new IllegalStateException("A2A_CALL_FAILED",e);}
    }
    private Task invoke(String target,String url,String context,String taskId,String text) throws Exception {
        var card=AgentCard.builder().name(target).description("Controlled Demo agent").provider(new AgentProvider("",""))
                .version("1.0").capabilities(new AgentCapabilities(false,false,false,List.of()))
                .defaultInputModes(List.of("text/plain")).defaultOutputModes(List.of("text/plain")).skills(List.of())
                .securitySchemes(Map.of()).securityRequirements(List.of())
                .supportedInterfaces(List.of(new AgentInterface("JSONRPC",url,null,"1.0"))).url(url).preferredTransport("JSONRPC").additionalInterfaces(List.of()).build();
        var http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        try(Client client=Client.builder(card).clientConfig(new ClientConfig.Builder().setStreaming(false).build())
                .withTransport(JSONRPCTransport.class,new JSONRPCTransportConfig(new JdkA2AHttpClient(http))).build()){
            var message=Message.builder().role(Message.Role.ROLE_USER).contextId(context).parts(List.of(new TextPart(text)));
            if(taskId!=null)message.taskId(taskId);
            var params=MessageSendParams.builder().message(message.build()).configuration(MessageSendConfiguration.builder().returnImmediately(false).build()).build();
            var result=new CompletableFuture<Task>();
            java.util.function.BiConsumer<ClientEvent,AgentCard> observer=(event,ignored)->{
                Task task=event instanceof TaskEvent item?item.getTask():event instanceof TaskUpdateEvent update?update.getTask():null;
                if(task==null){result.completeExceptionally(new IllegalStateException("UNSUPPORTED_A2A_RESPONSE"));return;}
                if(!context.equals(task.contextId())||taskId!=null&&!taskId.equals(task.id())){result.completeExceptionally(new IllegalStateException("A2A_CORRELATION_MISMATCH"));return;}
                if(task.status()!=null&&(task.status().state().isFinal()||task.status().state().isInterrupted()))result.complete(task);
                else result.completeExceptionally(new IllegalStateException("UNSUPPORTED_A2A_WAIT_STATE"));
            };
            client.sendMessage(params,List.of(observer),error->result.completeExceptionally(error),null);
            return result.get(10,TimeUnit.SECONDS);
        }
    }
    @Override public void close(){executor.shutdownNow();}
}

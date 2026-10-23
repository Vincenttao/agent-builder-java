export const generatedBalanceTool=`package generated;
import com.openjiuwen.core.foundation.tool.Tool;
import java.util.Map;
import java.util.Set;
public final class AccountBalanceTool extends Tool {
 private final Tool transport;
 public AccountBalanceTool(Tool transport){super(transport.getCard());this.transport=transport;}
 protected Object invokeInternal(Map<String,Object> input,Map<String,Object> context)throws Exception{
  if(!input.keySet().equals(Set.of("accountId"))||!(input.get("accountId") instanceof String id)||id.isBlank())throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");
  Object response=transport.invoke(input,context);
  if(!(response instanceof Map<?,?> data)||!(data.get("accountId") instanceof String)||!(data.get("currency") instanceof String)||!(data.get("availableBalanceFen") instanceof Integer||data.get("availableBalanceFen") instanceof Long)||!(data.get("asOf") instanceof String))throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");
  return Map.of("accountId",data.get("accountId"),"currency",data.get("currency"),"availableBalanceFen",data.get("availableBalanceFen"),"asOf",data.get("asOf"));
 }
}
`;
export const generatedBalanceUnit=`package generated;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.Map;
public final class AccountBalanceToolTest {
 static final class Transport extends Tool {
  Transport(){super(new ToolCard("balance@1","get_account_balance","fixture",Map.of()));}
  protected Object invokeInternal(Map<String,Object> input,Map<String,Object> context){return Map.of("accountId","A1001","currency","CNY","availableBalanceFen",1000000,"asOf","2026-10-21T08:00:00.000Z");}
 }
 public static void main(String[] args)throws Exception{
  Object actual=new AccountBalanceTool(new Transport()).invoke(Map.of("accountId","A1001"));
  if(!actual.equals(Map.of("accountId","A1001","currency","CNY","availableBalanceFen",1000000,"asOf","2026-10-21T08:00:00.000Z")))throw new AssertionError("balance response mapping");
  System.out.println("GENERATED_BALANCE_UNIT_OK");
 }
}
`;
export const generatedBalanceSkill=`---
name: balance-query
description: Query the simulated account balance from the registered business Tool.
---
Ask for accountId if it is missing. Call get_account_balance with accountId only. Report accountId, currency, availableBalanceFen and asOf exactly as returned. availableBalanceFen is an integer in fen. If the Tool is unavailable or its response is invalid, report that the balance is unknown. Never infer a balance or investment return.
`;

package com.openjiuwen.workbench;

import com.openjiuwen.workbench.runtime.TaskShelf;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class TaskShelfTest {
 private TaskShelf shelf(){return new TaskShelf(Set.of("idou","procurement","fallback"));}
 @Test void askingAndStayingDoNotCreateBAndThirdLayerCannotDispatch(){
  var shelf=shelf();String a=shelf.start("idou");shelf.waitForInput(a,"confirm-1");
  var request=shelf.requestSwitch("procurement",TaskShelf.Policy.ASK);assertEquals(a,shelf.snapshot().current().id());assertEquals(1,shelf.snapshot().tasks().size());
  shelf.decide(request,TaskShelf.Decision.STAY);assertEquals(a,shelf.snapshot().current().id());
  shelf.requestSwitch("procurement",TaskShelf.Policy.RETAIN);String b=shelf.snapshot().current().id();
  assertNotEquals(a,b);assertNotSame(shelf.session(a),shelf.session(b));assertEquals(a,shelf.snapshot().retained().id());
  assertEquals("TASK_DEPTH_LIMIT",assertThrows(IllegalStateException.class,()->shelf.requestSwitch("fallback",TaskShelf.Policy.RETAIN)).getMessage());
  assertEquals(b,shelf.snapshot().current().id());assertEquals(2,shelf.snapshot().tasks().size());
  assertThrows(IllegalArgumentException.class,()->shelf.requestSwitch("unmounted-agent",TaskShelf.Policy.RETAIN));
 }
 @Test void bFailurePreservesAAndResumingRequiresReviewAndFreshConfirmation(){
  var shelf=shelf();String a=shelf.start("idou");shelf.waitForInput(a,"old-confirmation");
  shelf.requestSwitch("procurement",TaskShelf.Policy.RETAIN);String b=shelf.snapshot().current().id();
  assertThrows(IllegalStateException.class,()->shelf.checkInput(a,"old-confirmation"));
  shelf.finish(b,false);assertEquals(a,shelf.snapshot().resumeCandidate());
  shelf.resume(a);assertEquals(TaskShelf.State.NEEDS_REVIEW,shelf.snapshot().current().state());
  assertThrows(IllegalStateException.class,()->shelf.checkInput(a,"old-confirmation"));
  shelf.review(a,true);assertThrows(IllegalStateException.class,()->shelf.waitForInput(a,"old-confirmation"));shelf.waitForInput(a,"new-confirmation");shelf.checkInput(a,"new-confirmation");
  assertEquals(a,shelf.session(a).getSessionId());
 }
 @Test void submittedAStillCountsAndLateReceiptDoesNotStealBOrResurrectA(){
  var shelf=shelf();String a=shelf.start("idou");shelf.submitted(a,"write-1");
  shelf.requestSwitch("procurement",TaskShelf.Policy.RETAIN);String b=shelf.snapshot().current().id();
  assertThrows(IllegalStateException.class,()->shelf.requestSwitch("fallback",TaskShelf.Policy.RETAIN));
  assertThrows(IllegalStateException.class,()->shelf.receipt(a,"wrong-call",true));
  shelf.receipt(a,"write-1",true);shelf.receipt(a,"write-1",true);
  assertEquals(b,shelf.snapshot().current().id());assertNull(shelf.snapshot().retained());
  shelf.finish(b,true);assertNull(shelf.snapshot().resumeCandidate());assertThrows(IllegalStateException.class,()->shelf.resume(a));
 }
 @Test void discardLeavesHistoryAndSubmittedOperationCannotPretendToBeCancelled(){
  var shelf=shelf();String a=shelf.start("idou");shelf.waitForInput(a,"confirmation");
  var request=shelf.requestSwitch("procurement",TaskShelf.Policy.ASK);shelf.decide(request,TaskShelf.Decision.DISCARD);
  assertEquals(TaskShelf.State.ABANDONED,shelf.snapshot().tasks().get(0).state());assertNull(shelf.snapshot().retained());
  assertThrows(IllegalStateException.class,()->shelf.resume(a));
  var second=shelf();String x=second.start("idou");second.submitted(x,"sent-1");
  assertThrows(IllegalStateException.class,()->second.requestSwitch("procurement",TaskShelf.Policy.DISCARD));
  assertEquals(x,second.snapshot().current().id());
 }
 @Test void resumedUnknownWriteOnlyQueriesOriginalCallAndCannotSubmitAgain(){
  var shelf=shelf();String a=shelf.start("idou");shelf.submitted(a,"original-key");
  shelf.requestSwitch("procurement",TaskShelf.Policy.RETAIN);shelf.finish(shelf.snapshot().current().id(),true);shelf.resume(a);
  assertEquals(TaskShelf.State.WAITING_RECEIPT,shelf.snapshot().current().state());assertEquals("original-key",shelf.snapshot().current().submittedCall());
  assertThrows(IllegalStateException.class,()->shelf.submitted(a,"new-key"));
  assertThrows(IllegalStateException.class,()->shelf.waitForInput(a,"retry-confirm"));
 }
 @Test void confirmedIntermediateWriteContinuesBeforeSeparateFinalConfirmation(){
  var shelf=shelf();String id=shelf.start("idou");shelf.submitted(id,"transfer-1");
  assertThrows(IllegalStateException.class,()->shelf.receipt(id,"wrong",true,false));
  shelf.receipt(id,"transfer-1",true,false);assertEquals(TaskShelf.State.ACTIVE,shelf.snapshot().current().state());assertNull(shelf.snapshot().current().submittedCall());
  shelf.waitForInput(id,"purchase-confirm");shelf.inputAccepted(id,"purchase-confirm");shelf.submitted(id,"purchase-1");shelf.receipt(id,"purchase-1",true);assertEquals(TaskShelf.State.COMPLETED,shelf.snapshot().current().state());
 }
}

package com.openjiuwen.workbench.deep;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.foundation.tool.function.LocalFunction;
import java.nio.file.*;
import java.io.IOException;
import java.util.*;
import java.util.function.Consumer;
/** One bounded, per-conversation artifact. No shell or arbitrary filesystem access. */
public final class ArtifactTools {
 private final Path root;private final Consumer<Map<String,Object>> events;private boolean wrote,readBack,selectionRequired;private Set<String> allowed=Set.of();
 public ArtifactTools(Path root,Consumer<Map<String,Object>> events){try{Files.createDirectories(root);if(Files.isSymbolicLink(root))throw new IllegalArgumentException("INVALID_WORKSPACE");this.root=root.toRealPath();}catch(IOException e){throw new IllegalStateException("WORKSPACE_UNAVAILABLE");}this.events=events;}
 public synchronized void beginTurn(){wrote=false;readBack=false;if(selectionRequired)allowed=Set.of();}
 public synchronized void requireSelection(boolean required){selectionRequired=required;}
 public synchronized void selectSkill(String id,Set<String> operations){allowed=Set.copyOf(operations);events.accept(Map.of("type","skill_loaded","skill",id,"operations",operations));}
 private void authorize(String operation){if(selectionRequired&&!allowed.contains(operation))throw new IllegalArgumentException("OPERATION_NOT_ASSEMBLED_FOR_SKILL");}
 public synchronized boolean verified(){return wrote&&readBack;}
 private Path target(String name){if(!"brief.md".equals(name))throw new IllegalArgumentException("ONLY_BRIEF_MD_ALLOWED");Path p=root.resolve(name);if(Files.isSymbolicLink(p))throw new IllegalArgumentException("SYMLINK_NOT_ALLOWED");return p;}
 public synchronized String read(String name){authorize("read_file");try{Path p=target(name);if(!Files.isRegularFile(p,LinkOption.NOFOLLOW_LINKS)||Files.size(p)>100000)throw new IllegalArgumentException("ARTIFACT_UNAVAILABLE");String text=Files.readString(p);if(wrote)readBack=true;events.accept(Map.of("type","artifact_read","file",name));return text;}catch(IOException e){throw new IllegalStateException("ARTIFACT_READ_FAILED");}}
 public synchronized Map<String,Object> write(String name,String text){authorize("write_file");if(text==null||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>50000)throw new IllegalArgumentException("ARTIFACT_TOO_LARGE");try{Files.writeString(target(name),text,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,LinkOption.NOFOLLOW_LINKS);wrote=true;readBack=false;events.accept(Map.of("type","artifact_written","file",name,"bytes",text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length));return Map.of("success",true,"file_path",name);}catch(IOException e){throw new IllegalStateException("ARTIFACT_WRITE_FAILED");}}
 public synchronized List<Map<String,Object>> artifacts(){Path p=target("brief.md");try{return Files.isRegularFile(p,LinkOption.NOFOLLOW_LINKS)&&Files.size(p)<=50000?List.of(Map.of("path","brief.md","content",Files.readString(p))):List.of();}catch(IOException e){throw new IllegalStateException("ARTIFACT_READ_FAILED");}}
 public List<Object> tools(){String prefix=UUID.randomUUID().toString();Map<String,Object> file=Map.of("type","object","properties",Map.of("file_path",Map.of("type","string","enum",List.of("brief.md"))),"required",List.of("file_path"),"additionalProperties",false);
  return List.of(new LocalFunction(ToolCard.builder().id(prefix+"-read").name("read_file").description("读取当前会话的 brief.md，写入后必须读回核对").inputParams(file).build(),args->{try{return Map.of("success",true,"content",read(Objects.toString(args.get("file_path"),"")));}catch(RuntimeException e){return Map.of("success",false,"error",e.getMessage());}}),
   new LocalFunction(ToolCard.builder().id(prefix+"-write").name("write_file").description("创建或更新当前会话 brief.md，后续必须读回").inputParams(Map.of("type","object","properties",Map.of("file_path",Map.of("type","string","enum",List.of("brief.md")),"content",Map.of("type","string","maxLength",50000)),"required",List.of("file_path","content"),"additionalProperties",false)).build(),args->{try{return write(Objects.toString(args.get("file_path"),""),Objects.toString(args.get("content"),""));}catch(RuntimeException e){return Map.of("success",false,"error",e.getMessage());}}),
   new LocalFunction(ToolCard.builder().id(prefix+"-list").name("list_files").description("列出本会话的整理稿文件").inputParams(Map.of("type","object","properties",Map.of(),"additionalProperties",false)).build(),args->{authorize("list_files");return Map.of("files",artifacts().isEmpty()?List.of():List.of("brief.md"));}));
 }
}

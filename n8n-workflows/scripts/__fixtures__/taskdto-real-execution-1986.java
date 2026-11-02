package com.pfe.devsecops.dto;

import java.time.LocalDate;
import java.util.Objects;

/**
 * Data Transfer Object representing a Task for exposure via the REST API.
 * This class intentionally contains no JPA annotations and is decoupled
 * from the persistence entity to avoid leaking internal persistence
 * structure (e.g. lazy-loaded associations) through the API contract.
 */
public class TaskDTO {

    private Long id;
    private String title;
    private String description;
    private boolean completed;
    private String priority;
    private LocalDate dueDate;

    public TaskDTO() {
    }

    public TaskDTO(Long id, String title, String description, boolean completed, String priority, LocalDate dueDate) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.completed = completed;
        this.priority = priority;
        this.dueDate = dueDate;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public boolean isCompleted() {
        return completed;
    }

    public void setCompleted(boolean completed) {
        this.completed = completed;
    }

    public String getPriority() {
        return priority;
    }

    public void setPriority(String priority) {
        this.priority = priority;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof TaskDTO)) {
            return false;
        }
        TaskDTO taskDTO = (TaskDTO) o;
        return completed == taskDTO.completed
                && Objects.equals(id, taskDTO.id)
                && Objects.equals(title, taskDTO.title)
                && Objects.equals(description, taskDTO.description)
                && Objects.equals(priority, taskDTO.priority)
                && Objects.equals(dueDate, taskDTO.dueDate);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, title, description, completed, priority, dueDate);
    }

    @Override
    public String toString() {
        return "TaskDTO{"
                + "id=" + id
                + ", title='" + title + '\''
                + ", description='" + description + '\''
                + ", completed=" + completed
                + ", priority='" + priority + '\''
                + ", dueDate=" + dueDate
                + '}';
    }
}
